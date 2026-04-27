/**
 * WaggleRunService — application-layer coordination for waggle mode execution.
 *
 * Waggle runs are Pi-native turns over the same canonical Pi session as standard
 * mode. This service owns product semantics (turn order, attribution, consensus,
 * persistence) and depends on the AgentKernelService port for runtime execution.
 */

import { randomUUID } from 'node:crypto'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import { CONSENSUS } from '@shared/constants/text-processing'
import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema, waggleMetadataSchema } from '@shared/schemas/waggle'
import {
  type AgentSendPayload,
  getMessageText,
  type HydratedAgentSendPayload,
  isToolCallPart,
  type Message,
} from '@shared/types/agent'
import { type ConversationId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SessionNode } from '@shared/types/session'
import type { Settings } from '@shared/types/settings'
import type { AgentTransportEvent } from '@shared/types/stream'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleMessageMetadata,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { formatErrorMessage } from '@shared/utils/node-error'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { checkConsensus } from '../agent/consensus-detector'
import { makeErrorInfo } from '../agent/error-classifier'
import { FileConflictTracker } from '../agent/file-conflict-tracker'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { createLogger } from '../logger'
import {
  type AgentKernelRunResult,
  AgentKernelService,
  type AgentKernelServiceShape,
  type AgentKernelSessionSnapshot,
} from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { type ProjectedSessionNodeInput, SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'

const SYNTHESIS_PROMPT_TRUNCATION_LENGTH = 3000
const UNRESOLVED_TOOL_NAME_PREVIEW_COUNT = 3
const logger = createLogger('waggle-run-service')

// ─── Types ───────────────────────────────────────────────────

export interface WaggleRunInput {
  readonly conversationId: ConversationId
  readonly payload: AgentSendPayload
  readonly config: WaggleConfig
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
}

interface UnresolvedToolCall {
  readonly id: string
  readonly name: string
  readonly state?: 'input-complete'
}

interface TurnRunOutcome {
  readonly workingConversation: Conversation
  readonly taggedAssistantMessages: readonly Message[]
  readonly responseText: string
  readonly hasToolCalls: boolean
  readonly agentResult?: AgentKernelRunResult
  readonly error?: string
}

// ─── Service Functions ───────────────────────────────────────

/**
 * Validate preconditions, execute the Waggle run, and persist results.
 * Returns a discriminated union describing the outcome.
 */
export function executeWaggleRun(input: WaggleRunInput) {
  return Effect.gen(function* () {
    const { conversationId, payload, config, signal, onEvent, onTurnEvent } = input
    let assignedTitle: string | undefined

    const parseResult = safeDecodeUnknown(waggleConfigSchema, config)
    if (!parseResult.success) {
      return {
        outcome: 'validation-error' as const,
        message: 'Invalid Waggle mode configuration',
        code: 'validation-error',
      }
    }

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const conversationRepo = yield* SessionProjectionRepository
    const conversation = yield* conversationRepo.getOptional(conversationId)

    if (!conversation) {
      const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
      return {
        outcome: 'not-found' as const,
        message: errorInfo.userMessage,
        code: errorInfo.code,
      }
    }

    if (!conversation.projectPath) {
      return {
        outcome: 'no-project' as const,
        message: 'Please select a project folder before starting Waggle mode.',
        code: 'no-project',
      }
    }
    const skillToggles = settings.skillTogglesByProject[conversation.projectPath]

    const nextTitle = yield* assignSessionTitleFromUserText(
      conversationId,
      conversation,
      payload.text,
    )
    if (nextTitle) {
      assignedTitle = nextTitle
    }

    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }

    const agentKernel = yield* AgentKernelService
    const accumulatedMessages: Message[] = [
      makeMessage('user', buildPersistedUserMessageParts(hydratedPayload)),
    ]
    let workingConversation: Conversation = { ...conversation }
    const conflictTracker = new FileConflictTracker()
    const waggleSessionId = randomUUID()
    const maxTurns = config.stop.maxTurnsSafety
    let lastAssistantTexts: [string, string] = ['', '']
    let status: WaggleCollaborationStatus = 'running'
    let consensusReason: string | undefined
    let consecutiveErrorTurns = 0
    let lastTurnError: string | undefined
    let successfulTurnCount = 0
    const sessionRepo = yield* SessionRepository
    const initialSessionTree = yield* sessionRepo.getTree(SessionId(String(conversationId)))
    const knownNodeIds = new Set<string>(
      initialSessionTree?.nodes.map((node) => String(node.id)) ?? [],
    )
    const waggleMetadataByNodeId = seedWaggleMetadataFromTree(initialSessionTree?.nodes ?? [])

    logger.info('Starting Pi-native Waggle collaboration', {
      conversationId,
      agents: config.agents.map((agent) => agent.label),
      maxTurns,
      stopCondition: config.stop.primary,
    })

    for (let turnNumber = 0; turnNumber < maxTurns; turnNumber += 1) {
      if (signal.aborted) {
        status = 'stopped'
        onTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
        break
      }

      const agentIndex = turnNumber % DOUBLE_FACTOR
      const agent = config.agents[agentIndex]
      if (!agent) {
        break
      }

      onTurnEvent({
        type: 'turn-start',
        turnNumber: successfulTurnCount,
        agentIndex,
        agentLabel: agent.label,
      })

      const meta: WaggleStreamMetadata = {
        agentIndex,
        agentLabel: agent.label,
        agentColor: agent.color,
        agentModel: agent.model,
        turnNumber: successfulTurnCount,
        collaborationMode: config.mode,
        sessionId: waggleSessionId,
      }

      const turnOutcome = yield* runWaggleTurn({
        agentKernel,
        workingConversation,
        payload: buildTurnPayload(hydratedPayload, config, agentIndex, turnNumber),
        ...(turnNumber === 0 ? { visibleUserRequest: hydratedPayload } : {}),
        model: agent.model,
        signal,
        meta,
        onEvent,
        skillToggles,
        onFileModified: (filePath) => {
          const warning = conflictTracker.recordModification(
            filePath,
            agentIndex,
            config.agents,
            turnNumber,
          )
          if (warning) {
            onTurnEvent({ type: 'file-conflict', warning })
          }
        },
      })

      workingConversation = turnOutcome.workingConversation

      if (turnOutcome.agentResult) {
        yield* persistWaggleSnapshot({
          conversationId,
          result: turnOutcome.agentResult,
          snapshot: applyWaggleMetadataToSnapshot({
            snapshot: turnOutcome.agentResult.sessionSnapshot,
            metadataByNodeId: waggleMetadataByNodeId,
            knownNodeIds,
            currentTurnMetadata: meta,
          }),
          waggleConfig: config,
        })
      }

      if (turnOutcome.error) {
        consecutiveErrorTurns += 1
        lastTurnError = turnOutcome.error
        logger.warn('Waggle turn failed', {
          conversationId,
          turnNumber,
          agentLabel: agent.label,
          consecutiveErrors: consecutiveErrorTurns,
          error: turnOutcome.error,
        })

        if (consecutiveErrorTurns >= DOUBLE_FACTOR) {
          status = 'stopped'
          onTurnEvent({
            type: 'collaboration-stopped',
            reason: turnOutcome.error,
          })
          break
        }
        continue
      }

      const unresolvedToolCalls = turnOutcome.taggedAssistantMessages.flatMap((message) =>
        getUnresolvedToolCalls(message),
      )
      if (unresolvedToolCalls.length > 0) {
        const unresolvedToolsSummary = summarizeUnresolvedTools(unresolvedToolCalls)
        const stopReason = `Waggle stopped because ${agent.label} has unresolved tool calls (${unresolvedToolsSummary}).`

        status = 'stopped'
        lastTurnError = stopReason
        onTurnEvent({ type: 'collaboration-stopped', reason: stopReason })
        logger.warn('Stopping Waggle due unresolved tool calls', {
          conversationId,
          turnNumber,
          agentLabel: agent.label,
          unresolvedToolCalls,
        })
        break
      }

      if (turnOutcome.responseText.trim().length === 0 && !turnOutcome.hasToolCalls) {
        consecutiveErrorTurns += 1
        lastTurnError = 'Agent turn produced no useful output.'
        if (consecutiveErrorTurns >= DOUBLE_FACTOR) {
          status = 'stopped'
          onTurnEvent({
            type: 'collaboration-stopped',
            reason: lastTurnError,
          })
          break
        }
        continue
      }

      consecutiveErrorTurns = 0
      const displayTurnNumber = successfulTurnCount
      successfulTurnCount += 1
      accumulatedMessages.push(...turnOutcome.taggedAssistantMessages)

      onTurnEvent({
        type: 'turn-end',
        turnNumber: displayTurnNumber,
        agentIndex,
        agentLabel: agent.label,
        agentColor: agent.color,
        agentModel: agent.model,
      })

      lastAssistantTexts = [lastAssistantTexts[1], turnOutcome.responseText]

      const successfulTurns = accumulatedMessages.filter(
        (message) => message.role === 'assistant',
      ).length
      if (
        config.stop.primary === 'consensus' &&
        successfulTurns >= DOUBLE_FACTOR &&
        lastAssistantTexts[0].trim().length > CONSENSUS.MIN_SUBSTANTIVE_LENGTH &&
        lastAssistantTexts[1].trim().length > CONSENSUS.MIN_SUBSTANTIVE_LENGTH
      ) {
        const consensusResult = checkConsensus(lastAssistantTexts, turnNumber + 1, maxTurns)
        if (consensusResult.reached) {
          status = 'completed'
          consensusReason = consensusResult.reason
          onTurnEvent({ type: 'consensus-reached', result: consensusResult })
          onTurnEvent({
            type: 'collaboration-complete',
            reason: `Consensus reached: ${consensusResult.reason}`,
            totalTurns: successfulTurnCount,
          })
          logger.info('Waggle consensus reached', {
            conversationId,
            totalTurns: successfulTurnCount,
            reason: consensusResult.reason,
          })
          break
        }
      }
    }

    if (status === 'running') {
      status = 'completed'
      onTurnEvent({
        type: 'collaboration-complete',
        reason: `Reached maximum turns (${String(successfulTurnCount)})`,
        totalTurns: successfulTurnCount,
      })
    }

    const synthesisFailure = yield* maybeRunSynthesis({
      agentKernel,
      conversationId,
      workingConversation,
      payload: hydratedPayload,
      config,
      settings,
      skillToggles,
      signal,
      accumulatedMessages,
      onEvent,
      onTurnEvent,
      waggleSessionId,
      waggleMetadataByNodeId,
      knownNodeIds,
    })
    if (synthesisFailure) {
      lastTurnError = synthesisFailure
    }

    if (signal.aborted) {
      return { outcome: 'aborted' as const, ...(assignedTitle ? { assignedTitle } : {}) }
    }

    logger.info('Pi-native Waggle collaboration finished', {
      conversationId,
      status,
      totalTurns: successfulTurnCount,
      consensusReason,
    })

    return {
      outcome: 'success' as const,
      newMessages: accumulatedMessages,
      lastError: lastTurnError,
      ...(assignedTitle ? { assignedTitle } : {}),
    }
  })
}

// ─── Internal Helpers ────────────────────────────────────────

function buildTurnPayload(
  payload: HydratedAgentSendPayload,
  config: WaggleConfig,
  agentIndex: number,
  turnNumber: number,
): HydratedAgentSendPayload {
  const agent = config.agents[agentIndex]
  const collaborationContext = buildCollaborationSystemPrompt(
    agent,
    agentIndex,
    config.agents,
    turnNumber,
  )

  return {
    ...payload,
    text: `${collaborationContext}\n\n---\n\nUser request:\n${payload.text}`,
    attachments: [],
  }
}

function buildCollaborationSystemPrompt(
  currentAgent: WaggleConfig['agents'][number],
  agentIndex: number,
  agents: WaggleConfig['agents'],
  turnNumber: number,
): string {
  const otherIndex = agentIndex === 0 ? 1 : 0
  const otherAgent = agents[otherIndex]
  if (!otherAgent) {
    return currentAgent.roleDescription
  }

  const lines = [
    `You are "${currentAgent.label}". ${currentAgent.roleDescription}`,
    '',
    `You are collaborating with "${otherAgent.label}" (${otherAgent.roleDescription}).`,
    `This is turn ${String(turnNumber + 1)} of the collaboration.`,
    '',
    'Guidelines:',
    '- Use tools to inspect real files and project state before making claims.',
    '- Build on previous contributions rather than repeating them.',
    '- If you agree with the other agent, say so explicitly and briefly.',
    '- If you disagree, explain your reasoning with references to actual code.',
    '- Focus on adding new value each turn.',
    '- End your turn with a concise, direct summary of your findings and position.',
  ]

  if (turnNumber > 0) {
    lines.push(
      '',
      'Review the conversation above and continue the collaboration.',
      'If the other agent made claims about the code, verify them by reading relevant files.',
      'Focus on your role and perspective.',
    )
  }

  return lines.join('\n')
}

function tagAssistantMessages(
  messages: readonly Message[],
  meta: WaggleStreamMetadata,
): readonly Message[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      makeMessage('assistant', [...message.parts], message.model, {
        ...message.metadata,
        waggle: {
          agentIndex: meta.agentIndex,
          agentLabel: meta.agentLabel,
          agentColor: meta.agentColor,
          agentModel: meta.agentModel,
          turnNumber: meta.turnNumber,
          sessionId: meta.sessionId,
          ...(meta.isSynthesis ? { isSynthesis: true } : {}),
        },
      }),
    )
}

function mergeWorkingConversation(
  conversation: Conversation,
  result: AgentKernelRunResult,
): Conversation {
  return {
    ...conversation,
    piSessionId: result.piSessionId,
    piSessionFile: result.piSessionFile,
    messages: [...conversation.messages, ...result.newMessages],
  }
}

function runWaggleTurn(input: {
  readonly agentKernel: AgentKernelServiceShape
  readonly workingConversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly visibleUserRequest?: HydratedAgentSendPayload
  readonly model: SupportedModelId
  readonly signal: AbortSignal
  readonly meta: WaggleStreamMetadata
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly onFileModified: (path: string) => void
}) {
  return input.agentKernel
    .runWaggleTurn({
      conversation: input.workingConversation,
      payload: input.payload,
      ...(input.visibleUserRequest ? { visibleUserRequest: input.visibleUserRequest } : {}),
      model: input.model,
      signal: input.signal,
      onEvent: (event) => {
        input.onEvent(event, input.meta)
        if (event.type !== 'tool_execution_end') {
          return
        }
        if (event.toolName !== 'write' && event.toolName !== 'edit') {
          return
        }
        const filePath = extractFilePath(event.args)
        if (filePath) {
          input.onFileModified(filePath)
        }
      },
      ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    })
    .pipe(
      Effect.match({
        onFailure: (err): TurnRunOutcome => ({
          workingConversation: input.workingConversation,
          taggedAssistantMessages: [],
          responseText: '',
          hasToolCalls: false,
          error: err instanceof Error ? err.message : String(err),
        }),
        onSuccess: (result: AgentKernelRunResult): TurnRunOutcome => {
          const workingConversation = mergeWorkingConversation(input.workingConversation, result)
          const taggedAssistantMessages = tagAssistantMessages(result.newMessages, input.meta)
          const responseText = taggedAssistantMessages.map(getMessageText).join('\n\n')
          const hasToolCalls = taggedAssistantMessages.some((message) =>
            message.parts.some(isToolCallPart),
          )

          return {
            workingConversation,
            taggedAssistantMessages,
            responseText,
            hasToolCalls,
            agentResult: result,
            ...(result.terminalError ? { error: result.terminalError } : {}),
          }
        },
      }),
    )
}

function getUnresolvedToolCalls(message: Message): UnresolvedToolCall[] {
  const unresolvedById = new Map<string, Omit<UnresolvedToolCall, 'id'>>()

  for (const part of message.parts) {
    if (part.type !== 'tool-call') {
      continue
    }

    const toolCallId = String(part.toolCall.id)
    unresolvedById.set(toolCallId, {
      name: part.toolCall.name,
      state: part.toolCall.state,
    })
  }

  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      unresolvedById.delete(String(part.toolResult.id))
    }
  }

  return [...unresolvedById.entries()].map(([id, data]) => ({ id, ...data }))
}

function summarizeUnresolvedTools(unresolvedToolCalls: readonly UnresolvedToolCall[]): string {
  const unresolvedToolNames = unresolvedToolCalls
    .slice(0, UNRESOLVED_TOOL_NAME_PREVIEW_COUNT)
    .map((toolCall) => toolCall.name)
    .join(', ')
  const moreToolsCount = unresolvedToolCalls.length - UNRESOLVED_TOOL_NAME_PREVIEW_COUNT
  return moreToolsCount > 0
    ? `${unresolvedToolNames} (+${String(moreToolsCount)} more)`
    : unresolvedToolNames
}

function buildSynthesisModelCandidates(
  settings: Settings,
  agents: WaggleConfig['agents'],
): readonly SupportedModelId[] {
  const primaryModel = settings.selectedModel
  const fallbackModel = agents[0]?.model
  if (!fallbackModel || fallbackModel === primaryModel) {
    return [primaryModel]
  }
  return [primaryModel, fallbackModel]
}

function buildSynthesisPrompt(
  userRequest: string,
  assistantMessages: readonly Message[],
  agents: WaggleConfig['agents'],
): string {
  const summaries = assistantMessages.map((message, index) => {
    const agentMeta = message.metadata?.waggle
    const label =
      agentMeta?.agentLabel ?? agents[index % agents.length]?.label ?? `Agent ${String(index)}`
    const text = getMessageText(message)
    const truncated =
      text.length > SYNTHESIS_PROMPT_TRUNCATION_LENGTH
        ? `${text.slice(0, SYNTHESIS_PROMPT_TRUNCATION_LENGTH)}... [truncated]`
        : text
    return `### ${label} (Turn ${String(index + 1)}):\n${truncated}`
  })

  return [
    'You are a neutral synthesis agent. Produce a clear, structured summary of the Waggle collaboration that just took place.',
    '',
    '## Original User Request',
    userRequest,
    '',
    '## Collaboration Transcript',
    ...summaries,
    '',
    '## Your Task',
    'Produce a concise synthesis with these sections:',
    '',
    '### Agreed',
    '### Disagreed',
    '### Key Findings',
    '### Open Questions',
    '### Recommendation',
    '',
    'Be concise. Focus on substance over meta-commentary. Do not use tools.',
  ].join('\n')
}

function maybeRunSynthesis(input: {
  readonly agentKernel: AgentKernelServiceShape
  readonly conversationId: ConversationId
  readonly workingConversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly config: WaggleConfig
  readonly settings: Settings
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly signal: AbortSignal
  readonly accumulatedMessages: Message[]
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly waggleSessionId: string
  readonly waggleMetadataByNodeId: Map<string, WaggleMessageMetadata>
  readonly knownNodeIds: Set<string>
}) {
  const successfulAssistantMessages = input.accumulatedMessages.filter(
    (message) => message.role === 'assistant',
  )
  if (
    successfulAssistantMessages.length < DOUBLE_FACTOR ||
    input.signal.aborted ||
    successfulAssistantMessages.some((message) => message.metadata?.waggle?.isSynthesis)
  ) {
    return Effect.succeed(undefined)
  }

  return Effect.gen(function* () {
    input.onTurnEvent({ type: 'synthesis-start' })
    const synthesisModels = buildSynthesisModelCandidates(input.settings, input.config.agents)
    const synthesisTurnNumber = successfulAssistantMessages.length
    const synthesisPrompt = buildSynthesisPrompt(
      input.payload.text,
      successfulAssistantMessages,
      input.config.agents,
    )
    const synthesisPayload: HydratedAgentSendPayload = {
      ...input.payload,
      text: synthesisPrompt,
      attachments: [],
    }
    let workingConversation = input.workingConversation
    let lastFailureReason: string | undefined

    for (const synthesisModel of synthesisModels) {
      const meta: WaggleStreamMetadata = {
        agentIndex: -1,
        agentLabel: 'Synthesis',
        agentColor: 'emerald',
        agentModel: synthesisModel,
        turnNumber: synthesisTurnNumber,
        collaborationMode: input.config.mode,
        isSynthesis: true,
        sessionId: input.waggleSessionId,
      }

      const result = yield* input.agentKernel
        .runWaggleTurn({
          conversation: workingConversation,
          payload: synthesisPayload,
          model: synthesisModel,
          signal: input.signal,
          onEvent: (event) => input.onEvent(event, meta),
          ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
        })
        .pipe(
          Effect.match({
            onFailure: (err) => ({
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            }),
            onSuccess: (value: AgentKernelRunResult) => ({ ok: true as const, value }),
          }),
        )

      if (!result.ok) {
        lastFailureReason = `Synthesis failed on model ${String(synthesisModel)}: ${result.error}`
        logger.warn('Waggle synthesis model failed', {
          conversationId: input.conversationId,
          model: synthesisModel,
          error: result.error,
        })
        continue
      }

      workingConversation = mergeWorkingConversation(workingConversation, result.value)
      const assistantMessages = result.value.newMessages.filter(
        (message) => message.role === 'assistant',
      )
      const responseText = assistantMessages.map(getMessageText).join('\n\n')
      if (!responseText.trim()) {
        lastFailureReason = `Synthesis produced no output on model ${String(synthesisModel)}.`
        continue
      }

      input.accumulatedMessages.push(...tagAssistantMessages(assistantMessages, meta))

      input.onTurnEvent({
        type: 'turn-end',
        turnNumber: synthesisTurnNumber,
        agentIndex: -1,
        agentLabel: 'Synthesis',
        agentColor: 'emerald',
        agentModel: synthesisModel,
      })
      yield* persistWaggleSnapshot({
        conversationId: input.conversationId,
        result: result.value,
        snapshot: applyWaggleMetadataToSnapshot({
          snapshot: result.value.sessionSnapshot,
          metadataByNodeId: input.waggleMetadataByNodeId,
          knownNodeIds: input.knownNodeIds,
          currentTurnMetadata: meta,
        }),
        waggleConfig: input.config,
      })
      return undefined
    }

    return lastFailureReason
  })
}

function toWaggleMessageMetadata(meta: WaggleStreamMetadata): WaggleMessageMetadata {
  return {
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    agentModel: meta.agentModel,
    turnNumber: meta.turnNumber,
    isSynthesis: meta.isSynthesis,
    sessionId: meta.sessionId,
  }
}

function parseMetadataJson(raw: string, nodeId: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    logger.warn('Failed to parse session node metadata JSON', {
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

function extractWaggleMetadata(node: SessionNode): WaggleMessageMetadata | null {
  const metadata = parseMetadataJson(node.metadataJson, String(node.id))
  const waggle = metadata.waggle
  if (waggle === undefined) {
    return null
  }
  const parsed = safeDecodeUnknown(waggleMetadataSchema, waggle)
  if (!parsed.success) {
    logger.warn('Ignoring invalid Waggle metadata on session node', {
      nodeId: String(node.id),
      issues: parsed.issues.join('; '),
    })
    return null
  }

  const agentModel = parsed.data.agentModel ? SupportedModelId(parsed.data.agentModel) : undefined

  return {
    agentIndex: parsed.data.agentIndex,
    agentLabel: parsed.data.agentLabel,
    agentColor: parsed.data.agentColor,
    ...(agentModel ? { agentModel } : {}),
    turnNumber: parsed.data.turnNumber,
    ...(parsed.data.isSynthesis !== undefined ? { isSynthesis: parsed.data.isSynthesis } : {}),
    ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {}),
  }
}

function seedWaggleMetadataFromTree(
  nodes: readonly SessionNode[],
): Map<string, WaggleMessageMetadata> {
  const metadataByNodeId = new Map<string, WaggleMessageMetadata>()
  for (const node of nodes) {
    if (node.kind !== 'assistant_message') {
      continue
    }
    const metadata = extractWaggleMetadata(node)
    if (metadata) {
      metadataByNodeId.set(String(node.id), metadata)
    }
  }
  return metadataByNodeId
}

function applyMetadataToNode(
  node: ProjectedSessionNodeInput,
  meta: WaggleMessageMetadata,
): ProjectedSessionNodeInput {
  return {
    ...node,
    metadataJson: JSON.stringify({
      ...parseMetadataJson(node.metadataJson, node.id),
      waggle: meta,
    }),
  }
}

function applyWaggleMetadataToSnapshot(input: {
  readonly snapshot: AgentKernelSessionSnapshot
  readonly metadataByNodeId: Map<string, WaggleMessageMetadata>
  readonly knownNodeIds: Set<string>
  readonly currentTurnMetadata: WaggleStreamMetadata
}): AgentKernelSessionSnapshot {
  const currentTurnMessageMetadata = toWaggleMessageMetadata(input.currentTurnMetadata)
  const nextNodes = input.snapshot.nodes.map((node) => {
    const wasKnown = input.knownNodeIds.has(node.id)
    input.knownNodeIds.add(node.id)

    if (node.kind !== 'assistant_message') {
      return node
    }

    const existingMeta = input.metadataByNodeId.get(node.id)
    if (existingMeta) {
      return applyMetadataToNode(node, existingMeta)
    }

    if (wasKnown) {
      return node
    }

    input.metadataByNodeId.set(node.id, currentTurnMessageMetadata)
    return applyMetadataToNode(node, currentTurnMessageMetadata)
  })

  return {
    ...input.snapshot,
    nodes: nextNodes,
  }
}

function persistWaggleSnapshot(input: {
  readonly conversationId: ConversationId
  readonly result: AgentKernelRunResult
  readonly snapshot: AgentKernelSessionSnapshot
  readonly waggleConfig: WaggleConfig | undefined
}) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(input.conversationId)),
      nodes: input.snapshot.nodes,
      activeNodeId: input.snapshot.activeNodeId,
      piSessionId: input.result.piSessionId,
      piSessionFile: input.result.piSessionFile,
      waggleConfig: input.waggleConfig,
    })
  }).pipe(
    Effect.tapError((persistError) =>
      Effect.sync(() =>
        logger.error('Failed to persist Waggle session snapshot', {
          conversationId: input.conversationId,
          error: formatErrorMessage(persistError),
        }),
      ),
    ),
  )
}

function extractFilePath(input: unknown): string {
  if (input == null || typeof input !== 'object') return ''
  const path = 'path' in input ? input.path : 'filePath' in input ? input.filePath : ''
  return typeof path === 'string' ? path : ''
}
