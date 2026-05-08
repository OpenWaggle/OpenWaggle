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
import { jsonObjectSchema } from '@shared/schemas/validation'
import { waggleConfigSchema, waggleMetadataSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { JsonObject } from '@shared/types/json'
import type { SessionNode } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleMessageMetadata,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { checkConsensus } from '../agent/consensus-detector'
import { makeErrorInfo } from '../agent/error-classifier'
import { FileConflictTracker } from '../agent/file-conflict-tracker'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { createLogger } from '../logger'
import {
  type AgentKernelRunResult,
  AgentKernelService,
  type AgentKernelSessionSnapshot,
} from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { type ProjectedSessionNodeInput, SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'

const UNRESOLVED_TOOL_NAME_PREVIEW_COUNT = 3
const MAIN_BRANCH_NAME = 'main'
const logger = createLogger('waggle-run-service')

// ─── Types ───────────────────────────────────────────────────

export interface WaggleRunInput {
  readonly sessionId: SessionId
  readonly runId: string
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

interface ActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}

// ─── Service Functions ───────────────────────────────────────

/**
 * Validate preconditions, execute the Waggle run, and persist results.
 * Returns a discriminated union describing the outcome.
 */
export function executeWaggleRun(input: WaggleRunInput) {
  let activeRunIdentity: ActiveRunIdentity | null = null

  return Effect.gen(function* () {
    const { sessionId, runId, payload, config, signal, onEvent, onTurnEvent } = input
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
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(sessionId)

    if (!session) {
      const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
      return {
        outcome: 'not-found' as const,
        message: errorInfo.userMessage,
        code: errorInfo.code,
      }
    }

    if (!session.projectPath) {
      return {
        outcome: 'no-project' as const,
        message: 'Please select a project folder before starting Waggle mode.',
        code: 'no-project',
      }
    }
    const skillToggles = settings.skillTogglesByProject[session.projectPath]

    const nextTitle = yield* assignSessionTitleFromUserText(sessionId, session, payload.text)
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
    const initialSessionTree = yield* sessionRepo.getTree(SessionId(String(sessionId)))
    const knownNodeIds = new Set<string>(
      initialSessionTree?.nodes.map((node) => String(node.id)) ?? [],
    )
    const waggleMetadataByNodeId = seedWaggleMetadataFromTree(initialSessionTree?.nodes ?? [])
    const newTurnMetadata: WaggleMessageMetadata[] = []
    const branchId =
      initialSessionTree?.session.lastActiveBranchId ??
      initialSessionTree?.branches.find((branch) => branch.isMain)?.id ??
      SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)

    yield* sessionRepo.clearInterruptedRuns({ sessionId, branchId })
    yield* sessionRepo.recordActiveRun({
      runId,
      sessionId,
      branchId,
      runMode: 'waggle',
      model: config.agents[0].model,
    })
    activeRunIdentity = { sessionId, runId }

    logger.info('Starting Pi-native Waggle collaboration', {
      sessionId,
      agents: config.agents.map((agent) => agent.label),
      maxTurns,
      stopCondition: config.stop.primary,
    })

    function createTurnMetadata(input: {
      readonly turnNumber: number
      readonly agentIndex: number
    }): WaggleStreamMetadata {
      const { turnNumber, agentIndex } = input
      const agent = config.agents[agentIndex]
      return {
        agentIndex,
        agentLabel: agent.label,
        agentColor: agent.color,
        agentModel: agent.model,
        turnNumber,
        collaborationMode: config.mode,
        sessionId: waggleSessionId,
      }
    }

    function handleWaggleEvent(event: AgentTransportEvent, meta: WaggleStreamMetadata): void {
      onEvent(event, meta)
      if (event.type !== 'tool_execution_end') {
        return
      }
      if (event.toolName !== 'write' && event.toolName !== 'edit') {
        return
      }
      const filePath = extractFilePath(event.args)
      if (!filePath) {
        return
      }
      const warning = conflictTracker.recordModification(
        filePath,
        meta.agentIndex,
        config.agents,
        meta.turnNumber,
      )
      if (warning) {
        onTurnEvent({ type: 'file-conflict', warning })
      }
    }

    function handleTurnComplete(input: {
      readonly meta: WaggleStreamMetadata
      readonly assistantMessages: readonly Message[]
      readonly responseText: string
      readonly hasToolCalls: boolean
      readonly terminalError?: string
    }): { readonly continue: boolean } {
      const { meta } = input

      if (input.terminalError) {
        consecutiveErrorTurns += 1
        lastTurnError = input.terminalError
        logger.warn('Waggle turn failed', {
          sessionId,
          turnNumber: meta.turnNumber,
          agentLabel: meta.agentLabel,
          consecutiveErrors: consecutiveErrorTurns,
          error: input.terminalError,
        })

        if (consecutiveErrorTurns >= DOUBLE_FACTOR) {
          status = 'stopped'
          onTurnEvent({
            type: 'collaboration-stopped',
            reason: input.terminalError,
          })
          return { continue: false }
        }
        return { continue: true }
      }

      const taggedAssistantMessages = tagAssistantMessages(input.assistantMessages, meta)
      const unresolvedToolCalls = taggedAssistantMessages.flatMap((message) =>
        getUnresolvedToolCalls(message),
      )
      if (unresolvedToolCalls.length > 0) {
        const unresolvedToolsSummary = summarizeUnresolvedTools(unresolvedToolCalls)
        const stopReason = `Waggle stopped because ${meta.agentLabel} has unresolved tool calls (${unresolvedToolsSummary}).`

        status = 'stopped'
        lastTurnError = stopReason
        onTurnEvent({ type: 'collaboration-stopped', reason: stopReason })
        logger.warn('Stopping Waggle due unresolved tool calls', {
          sessionId,
          turnNumber: meta.turnNumber,
          agentLabel: meta.agentLabel,
          unresolvedToolCalls,
        })
        return { continue: false }
      }

      if (input.responseText.trim().length === 0 && !input.hasToolCalls) {
        consecutiveErrorTurns += 1
        lastTurnError = 'Agent turn produced no useful output.'
        if (consecutiveErrorTurns >= DOUBLE_FACTOR) {
          status = 'stopped'
          onTurnEvent({
            type: 'collaboration-stopped',
            reason: lastTurnError,
          })
          return { continue: false }
        }
        return { continue: true }
      }

      consecutiveErrorTurns = 0
      successfulTurnCount += 1
      accumulatedMessages.push(...taggedAssistantMessages)
      for (const _message of taggedAssistantMessages) {
        newTurnMetadata.push(toWaggleMessageMetadata(meta))
      }

      onTurnEvent({
        type: 'turn-end',
        turnNumber: meta.turnNumber,
        agentIndex: meta.agentIndex,
        agentLabel: meta.agentLabel,
        agentColor: meta.agentColor,
        agentModel: meta.agentModel,
      })

      lastAssistantTexts = [lastAssistantTexts[1], input.responseText]

      const successfulTurns = accumulatedMessages.filter(
        (message) => message.role === 'assistant',
      ).length
      if (
        config.stop.primary === 'consensus' &&
        successfulTurns >= DOUBLE_FACTOR &&
        lastAssistantTexts[0].trim().length > CONSENSUS.MIN_SUBSTANTIVE_LENGTH &&
        lastAssistantTexts[1].trim().length > CONSENSUS.MIN_SUBSTANTIVE_LENGTH
      ) {
        const consensusResult = checkConsensus(lastAssistantTexts, meta.turnNumber + 1, maxTurns)
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
            sessionId,
            totalTurns: successfulTurnCount,
            reason: consensusResult.reason,
          })
          return { continue: false }
        }
      }

      return { continue: true }
    }

    const agentResult = yield* agentKernel.runWaggle({
      session,
      runId,
      payload: hydratedPayload,
      model: config.agents[0].model,
      config,
      signal,
      skillToggles,
      onEvent: () => undefined,
      onWaggleEvent: handleWaggleEvent,
      onTurnEvent,
      createTurnMetadata,
      onTurnComplete: handleTurnComplete,
    })

    if (agentResult.aborted || signal.aborted) {
      status = 'stopped'
      onTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
      return { outcome: 'aborted' as const, ...(assignedTitle ? { assignedTitle } : {}) }
    }

    yield* persistWaggleSnapshot({
      sessionId,
      result: agentResult,
      snapshot: applyWaggleMetadataToSnapshot({
        snapshot: agentResult.sessionSnapshot,
        metadataByNodeId: waggleMetadataByNodeId,
        knownNodeIds,
        newTurnMetadata,
      }),
      waggleConfig: config,
    })

    if (status === 'running') {
      status = 'completed'
      onTurnEvent({
        type: 'collaboration-complete',
        reason: `Reached maximum turns (${String(successfulTurnCount)})`,
        totalTurns: successfulTurnCount,
      })
    }

    logger.info('Pi-native Waggle collaboration finished', {
      sessionId,
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
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (!activeRunIdentity) {
          return
        }
        const sessionRepo = yield* SessionRepository
        yield* sessionRepo.clearActiveRun(activeRunIdentity).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              logger.warn('Failed to clear durable Waggle active run', {
                sessionId: activeRunIdentity?.sessionId,
                runId: activeRunIdentity?.runId,
                error: formatErrorMessage(error),
              })
            }),
          ),
        )
      }),
    ),
  )
}

// ─── Internal Helpers ────────────────────────────────────────

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

function toWaggleMessageMetadata(meta: WaggleStreamMetadata): WaggleMessageMetadata {
  return {
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    agentModel: meta.agentModel,
    turnNumber: meta.turnNumber,
    sessionId: meta.sessionId,
  }
}

function parseMetadataJson(raw: string, nodeId: string): JsonObject {
  try {
    const parsed = JSON.parse(raw)
    const result = safeDecodeUnknown(jsonObjectSchema, parsed)
    if (!result.success) {
      logger.warn('Ignoring invalid session node metadata JSON', {
        nodeId,
        issues: result.issues.join('; '),
      })
      return {}
    }
    return result.data
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
      waggle: waggleMetadataToJson(meta),
    }),
  }
}

function waggleMetadataToJson(meta: WaggleMessageMetadata): JsonObject {
  return {
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    ...(meta.agentModel ? { agentModel: String(meta.agentModel) } : {}),
    turnNumber: meta.turnNumber,
    ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
  }
}

function applyWaggleMetadataToSnapshot(input: {
  readonly snapshot: AgentKernelSessionSnapshot
  readonly metadataByNodeId: Map<string, WaggleMessageMetadata>
  readonly knownNodeIds: Set<string>
  readonly newTurnMetadata: readonly WaggleMessageMetadata[]
}): AgentKernelSessionSnapshot {
  let newMetadataIndex = 0
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

    const metadata = input.newTurnMetadata[newMetadataIndex]
    newMetadataIndex += 1
    if (!metadata) {
      return node
    }

    input.metadataByNodeId.set(node.id, metadata)
    return applyMetadataToNode(node, metadata)
  })

  return {
    ...input.snapshot,
    nodes: nextNodes,
  }
}

function persistWaggleSnapshot(input: {
  readonly sessionId: SessionId
  readonly result: AgentKernelRunResult
  readonly snapshot: AgentKernelSessionSnapshot
  readonly waggleConfig: WaggleConfig | undefined
}) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(input.sessionId)),
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
          sessionId: input.sessionId,
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
