import { DOUBLE_FACTOR } from '@shared/constants/constants'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { getMessageText, isToolCallPart } from '@shared/types/agent'
import {
  type ConversationId,
  createSkipApprovalToken,
  type SupportedModelId,
} from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { createLogger } from '../logger'
import type { ChatStreamOptions } from '../ports/chat-service'
import { runAgent } from './agent-loop'
import { checkConsensus } from './consensus-detector'
import { FileConflictTracker } from './file-conflict-tracker'
import { makeMessage } from './shared'
import { WaggleFileCache } from './waggle-file-cache'

const SLICE_ARG_2 = 200
const RUN_WAGGLE_SEQUENTIAL_VALUE_20 = 20
const FUNCTION_VALUE_3000 = 3000
const SLICE_ARG_2_VALUE_3000 = 3000
const UNRESOLVED_TOOL_NAME_PREVIEW_COUNT = 3
/** Waggle turns may run orchestrate tools that take minutes. Use 10 min stall timeout. */
const WAGGLE_STALL_TIMEOUT_MS = 600_000

const logger = createLogger('waggle')

export interface WaggleRunParams {
  readonly conversationId: ConversationId
  readonly conversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly config: WaggleConfig
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
  readonly onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly onTurnComplete?: (accumulatedMessages: readonly Message[]) => Promise<void>
}

export interface WaggleRunResult {
  readonly newMessages: readonly Message[]
  readonly status: WaggleCollaborationStatus
  readonly totalTurns: number
  readonly consensusReason?: string
  readonly lastError?: string
}

interface UnresolvedToolCall {
  readonly id: string
  readonly name: string
  readonly state?: 'input-complete' | 'approval-requested' | 'approval-responded'
  readonly needsApproval: boolean
}

interface SynthesisStepResult {
  readonly success: boolean
  readonly failureReason?: string
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
      needsApproval: part.toolCall.approval?.needsApproval === true,
    })
  }

  for (const part of message.parts) {
    if (part.type !== 'tool-result') {
      continue
    }

    unresolvedById.delete(String(part.toolResult.id))
  }

  return [...unresolvedById.entries()].map(([id, data]) => ({ id, ...data }))
}

function buildSynthesisModelCandidates(
  settings: Settings,
  agents: WaggleConfig['agents'],
): readonly SupportedModelId[] {
  const primaryModel = settings.defaultModel
  const fallbackModel = agents[0]?.model
  if (!fallbackModel || fallbackModel === primaryModel) {
    return [primaryModel]
  }
  return [primaryModel, fallbackModel]
}

/**
 * Run a Waggle mode sequential collaboration.
 * Two agents take turns responding, building on each other's output.
 */
export async function runWaggleSequential(params: WaggleRunParams): Promise<WaggleRunResult> {
  const {
    conversationId,
    conversation,
    payload,
    config,
    settings,
    signal,
    onStreamChunk,
    onTurnEvent,
    onTurnComplete,
  } = params
  const { agents, stop } = config
  const maxTurns = stop.maxTurnsSafety
  const waggleFileCache = new WaggleFileCache()

  try {
    const conflictTracker = new FileConflictTracker()
    const accumulatedMessages: Message[] = []

    // Build the initial user message (saved to persistence, not to working conversation)
    const userParts: Message['parts'] = payload.text.trim()
      ? [{ type: 'text', text: payload.text.trim() }]
      : [{ type: 'text', text: '' }]
    const userMessage = makeMessage('user', [...userParts])
    accumulatedMessages.push(userMessage)

    // Working conversation — does NOT include the initial user message here because
    // runAgent() adds its own user message from the payload. After each turn we
    // append both the per-turn user message and the assistant response to maintain
    // proper user/assistant alternation for subsequent turns.
    let workingConversation: Conversation = { ...conversation }

    let lastAssistantTexts: [string, string] = ['', '']
    let status: WaggleCollaborationStatus = 'running'
    let consensusReason: string | undefined
    let consecutiveErrorTurns = 0
    let lastTurnError: string | undefined
    let successfulTurnCount = 0

    logger.info('Starting Waggle mode sequential collaboration', {
      conversationId,
      userMessage: payload.text.slice(0, SLICE_ARG_2),
      agents: agents.map((a) => a.label),
      maxTurns,
      stopCondition: stop.primary,
    })

    for (let turnNumber = 0; turnNumber < maxTurns; turnNumber++) {
      if (signal.aborted) {
        status = 'stopped'
        onTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
        break
      }

      const agentIndex = turnNumber % DOUBLE_FACTOR
      const agent = agents[agentIndex]
      if (!agent) break

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
        collaborationMode: 'sequential',
      }

      // Build augmented payload with collaboration context.
      // Always include the original user question so every agent sees the request clearly.
      const collaborationContext = buildCollaborationSystemPrompt(
        agent,
        agentIndex,
        agents,
        turnNumber,
      )
      const augmentedPayload: HydratedAgentSendPayload = {
        ...payload,
        text: `${collaborationContext}\n\n---\n\nUser request:\n${payload.text}`,
        attachments: turnNumber === 0 ? payload.attachments : [],
      }

      try {
        let turnHadError = false
        const result = await runAgent({
          conversation: workingConversation,
          payload: augmentedPayload,
          model: agent.model,
          settings,
          chatStream: params.chatStream,
          skipApproval: createSkipApprovalToken(),
          stallTimeoutMs: WAGGLE_STALL_TIMEOUT_MS,
          waggleContext: {
            agentLabel: agent.label,
            fileCache: waggleFileCache,
          },
          onChunk: (chunk) => {
            onStreamChunk(chunk, meta)

            // Track per-turn API errors (e.g. insufficient credits)
            if (chunk.type === 'RUN_ERROR') {
              turnHadError = true
              lastTurnError = chunk.error.message
            }

            // Track file conflicts from tool calls
            if (chunk.type === 'TOOL_CALL_END') {
              if (chunk.toolName === 'writeFile' || chunk.toolName === 'editFile') {
                const filePath = extractFilePath(chunk.input)
                if (filePath) {
                  const warning = conflictTracker.recordModification(
                    filePath,
                    agentIndex,
                    agents,
                    turnNumber,
                  )
                  if (warning) {
                    onTurnEvent({ type: 'file-conflict', warning })
                  }
                }
              }
            }
          },
          signal,
        })

        // Check if the agent produced meaningful output.
        // API errors (e.g. insufficient credits) come as stream events, not exceptions,
        // so runAgent "succeeds" but the StreamPartCollector bakes the error text into
        // the message as "**Error:** ...". Detect this and bail early on repeated failures.
        // Tool-call-only responses (no text) are still useful — the agent did work.
        const assistantMsg = result.finalMessage
        const responseText = getMessageText(assistantMsg)
        const hasToolCalls = assistantMsg.parts.some(isToolCallPart)
        const unresolvedToolCalls = getUnresolvedToolCalls(assistantMsg)

        if (unresolvedToolCalls.length > 0) {
          const unresolvedToolNames = unresolvedToolCalls
            .slice(0, UNRESOLVED_TOOL_NAME_PREVIEW_COUNT)
            .map((toolCall) => toolCall.name)
            .join(', ')
          const moreToolsCount = unresolvedToolCalls.length - UNRESOLVED_TOOL_NAME_PREVIEW_COUNT
          const unresolvedToolsSummary =
            moreToolsCount > 0
              ? `${unresolvedToolNames} (+${String(moreToolsCount)} more)`
              : unresolvedToolNames
          const stopReason = `Waggle stopped because ${agent.label} has unresolved tool calls (${unresolvedToolsSummary}).`

          status = 'stopped'
          lastTurnError = stopReason
          onTurnEvent({
            type: 'collaboration-stopped',
            reason: stopReason,
          })
          logger.warn('Stopping waggle due unresolved tool calls', {
            conversationId,
            turnNumber,
            agentLabel: agent.label,
            unresolvedToolCalls,
          })
          break
        }

        if (turnHadError || (responseText.trim().length === 0 && !hasToolCalls)) {
          consecutiveErrorTurns++
          logger.warn('Agent turn produced no useful output', {
            conversationId,
            turnNumber,
            agentLabel: agent.label,
            model: agent.model,
            hadStreamError: turnHadError,
            consecutiveErrors: consecutiveErrorTurns,
            error: lastTurnError,
          })

          if (consecutiveErrorTurns >= DOUBLE_FACTOR) {
            status = 'stopped'
            onTurnEvent({
              type: 'collaboration-stopped',
              reason: lastTurnError ?? 'Multiple consecutive agent failures',
            })
            break
          }
          continue
        }

        consecutiveErrorTurns = 0

        // Use sequential successful-turn count for display metadata
        // so the UI shows "Turn 1, 2, 3..." without gaps from failed turns.
        const displayTurnNumber = successfulTurnCount
        successfulTurnCount++

        // Tag assistant message with Waggle metadata.
        const taggedMessage = makeMessage(
          'assistant',
          [...assistantMsg.parts],
          assistantMsg.model,
          {
            ...assistantMsg.metadata,
            waggle: {
              agentIndex,
              agentLabel: agent.label,
              agentColor: agent.color,
              agentModel: agent.model,
              turnNumber: displayTurnNumber,
            },
          },
        )

        // Only persist the tagged assistant messages (+ the initial user message added above)
        accumulatedMessages.push(taggedMessage)

        // Update working conversation with BOTH the per-turn user message and
        // the assistant response to maintain proper user/assistant alternation.
        // runAgent() creates a user message from the payload — grab it from the result.
        const turnUserMsg = result.newMessages.find((m) => m.role === 'user')
        workingConversation = {
          ...workingConversation,
          messages: [
            ...workingConversation.messages,
            ...(turnUserMsg ? [turnUserMsg] : []),
            taggedMessage,
          ],
        }

        onTurnEvent({
          type: 'turn-end',
          turnNumber: displayTurnNumber,
          agentIndex,
          agentLabel: agent.label,
          agentColor: agent.color,
          agentModel: agent.model,
        })

        // Persist accumulated messages after each successful turn
        await onTurnComplete?.(accumulatedMessages)

        // Track text for consensus
        lastAssistantTexts = [lastAssistantTexts[1], responseText]

        // Check consensus after at least 2 successful turns.
        // Both messages must have substantive content to avoid false positives.
        const successfulTurns = accumulatedMessages.filter((m) => m.role === 'assistant').length
        if (
          stop.primary === 'consensus' &&
          successfulTurns >= DOUBLE_FACTOR &&
          lastAssistantTexts[0].trim().length > RUN_WAGGLE_SEQUENTIAL_VALUE_20 &&
          lastAssistantTexts[1].trim().length > RUN_WAGGLE_SEQUENTIAL_VALUE_20
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
            logger.info('Consensus reached', {
              conversationId,
              turnNumber: successfulTurnCount,
              confidence: consensusResult.confidence,
              reason: consensusResult.reason,
            })
            break
          }
        }
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.message === 'aborted')) {
          status = 'stopped'
          onTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
          break
        }
        throw err
      }
    }

    if (status === 'running') {
      // Reached max turns without consensus
      status = 'completed'
      const totalTurns = accumulatedMessages.filter((m) => m.role === 'assistant').length
      onTurnEvent({
        type: 'collaboration-complete',
        reason: `Reached maximum turns (${String(totalTurns)})`,
        totalTurns,
      })
    }

    // ─── Synthesis step ──────────────────────────────────────────
    // After the collaboration loop, produce a final synthesis if we had
    // at least 2 successful assistant turns and the run wasn't aborted.
    const successfulAssistantMsgs = accumulatedMessages.filter((m) => m.role === 'assistant')
    if (
      successfulAssistantMsgs.length >= DOUBLE_FACTOR &&
      status !== 'stopped' &&
      !signal.aborted
    ) {
      const synthesisResult = await runSynthesisStep({
        conversationId,
        workingConversation,
        payload,
        agents,
        settings,
        signal,
        chatStream: params.chatStream,
        accumulatedMessages,
        successfulAssistantMsgs,
        onStreamChunk,
        onTurnEvent,
        onTurnComplete,
        waggleFileCache,
      })
      if (!synthesisResult.success && synthesisResult.failureReason) {
        lastTurnError = synthesisResult.failureReason
      }
    }

    // Use the debate turn counter — synthesis is no longer tagged with waggle
    // metadata so we can't rely on filtering by isSynthesis.
    const totalTurns = successfulTurnCount
    logger.info('Waggle collaboration finished', {
      conversationId,
      status,
      totalTurns,
      consensusReason,
    })

    return {
      newMessages: accumulatedMessages,
      status,
      totalTurns,
      consensusReason,
      lastError: lastTurnError,
    }
  } finally {
    waggleFileCache.clear()
  }
}

function buildCollaborationSystemPrompt(
  currentAgent: { label: string; roleDescription: string },
  agentIndex: number,
  agents: readonly [
    { label: string; roleDescription: string },
    { label: string; roleDescription: string },
  ],
  turnNumber: number,
): string {
  const otherIndex = agentIndex === 0 ? 1 : 0
  const otherAgent = agents[otherIndex]
  if (!otherAgent) return currentAgent.roleDescription

  const lines = [
    `You are "${currentAgent.label}". ${currentAgent.roleDescription}`,
    '',
    `You are collaborating with "${otherAgent.label}" (${otherAgent.roleDescription}).`,
    `This is turn ${String(turnNumber + 1)} of the collaboration.`,
    '',
    'Guidelines:',
    '- USE YOUR TOOLS to read actual code, files, and project structure before making claims.',
    '  Use readFile, glob, listFiles, and runCommand to inspect the real implementation.',
    '  Do not rely on assumptions — verify by reading the source code.',
    '- Build on previous contributions rather than repeating them.',
    '- If you agree with the other agent, say so explicitly and briefly.',
    '- If you disagree, explain your reasoning clearly with references to actual code.',
    '- Focus on adding new value each turn.',
    '- End your turn with a concise, direct summary of your findings and position. Write naturally — do not label it with "Synthesis:", "Summary:", or similar prefixes.',
  ]

  if (turnNumber > 0) {
    lines.push(
      '',
      'Review the conversation above and continue the collaboration.',
      'If the other agent made claims about the code, verify them by reading the relevant files yourself.',
      'Focus on your role and perspective.',
    )
  }

  return lines.join('\n')
}

// ─── Synthesis ──────────────────────────────────────────────────

interface SynthesisParams {
  readonly conversationId: ConversationId
  readonly workingConversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly agents: WaggleConfig['agents']
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
  readonly accumulatedMessages: Message[]
  readonly successfulAssistantMsgs: Message[]
  readonly onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly onTurnComplete?: (accumulatedMessages: readonly Message[]) => Promise<void>
  readonly waggleFileCache: WaggleFileCache
}

async function runSynthesisStep(params: SynthesisParams): Promise<SynthesisStepResult> {
  const {
    conversationId,
    workingConversation,
    payload,
    agents,
    settings,
    signal,
    accumulatedMessages,
    successfulAssistantMsgs,
    onStreamChunk,
    onTurnEvent,
    onTurnComplete,
    waggleFileCache,
  } = params

  // Prefer the user's standard model for synthesis, then fall back to Agent A's
  // model if synthesis fails. This avoids silent missing synthesis output when
  // the default model is temporarily unavailable.
  const synthesisModels = buildSynthesisModelCandidates(settings, agents)
  const synthesisTurnNumber = successfulAssistantMsgs.length

  logger.info('Starting synthesis step', {
    conversationId,
    model: synthesisModels[0],
    fallbackModel: synthesisModels[1],
    debateTurns: successfulAssistantMsgs.length,
  })

  onTurnEvent({ type: 'synthesis-start' })

  const synthesisPrompt = buildSynthesisPrompt(payload.text, successfulAssistantMsgs, agents)
  const synthesisPayload: HydratedAgentSendPayload = {
    ...payload,
    text: synthesisPrompt,
    attachments: [],
  }
  let lastFailureReason: string | undefined

  for (let attemptIndex = 0; attemptIndex < synthesisModels.length; attemptIndex++) {
    const synthesisModel = synthesisModels[attemptIndex]
    const nextFallbackModel = synthesisModels[attemptIndex + 1]
    const synthesisMeta: WaggleStreamMetadata = {
      agentIndex: -1,
      agentLabel: 'Synthesis',
      agentColor: 'emerald',
      agentModel: synthesisModel,
      turnNumber: synthesisTurnNumber,
      collaborationMode: 'sequential',
      isSynthesis: true,
    }

    try {
      const result = await runAgent({
        conversation: workingConversation,
        payload: synthesisPayload,
        model: synthesisModel,
        settings,
        chatStream: params.chatStream,
        skipApproval: createSkipApprovalToken(),
        stallTimeoutMs: WAGGLE_STALL_TIMEOUT_MS,
        waggleContext: {
          agentLabel: 'Synthesis',
          fileCache: waggleFileCache,
        },
        onChunk: (chunk) => {
          // Filter terminal events — the envelope handles those
          if (
            chunk.type === 'RUN_STARTED' ||
            chunk.type === 'RUN_FINISHED' ||
            chunk.type === 'RUN_ERROR'
          ) {
            return
          }
          onStreamChunk(chunk, synthesisMeta)
        },
        signal,
      })

      const assistantMsg = result.finalMessage
      const responseText = getMessageText(assistantMsg)

      if (responseText.trim().length > 0) {
        // Synthesis is persisted WITHOUT waggle metadata so it renders as
        // a plain assistant message — no agent colors, no turn divider.
        const taggedSynthesis = makeMessage(
          'assistant',
          [...assistantMsg.parts],
          assistantMsg.model,
          assistantMsg.metadata,
        )
        accumulatedMessages.push(taggedSynthesis)

        onTurnEvent({
          type: 'turn-end',
          turnNumber: synthesisTurnNumber,
          agentIndex: -1,
          agentLabel: 'Synthesis',
          agentColor: 'emerald',
          agentModel: synthesisModel,
        })

        // Persist after synthesis
        await onTurnComplete?.(accumulatedMessages)

        logger.info('Synthesis step completed', {
          conversationId,
          model: synthesisModel,
          usedFallbackModel: attemptIndex > 0,
        })
        return { success: true }
      }

      lastFailureReason = `Synthesis produced no output on model ${String(synthesisModel)}.`
      logger.warn('Synthesis step produced no output', {
        conversationId,
        model: synthesisModel,
      })
    } catch (err) {
      // Don't fail the whole collaboration if synthesis is aborted
      if (signal.aborted || (err instanceof Error && err.message === 'aborted')) {
        return { success: false, failureReason: 'Synthesis cancelled.' }
      }
      const errorMessage = err instanceof Error ? err.message : String(err)
      lastFailureReason = `Synthesis failed on model ${String(synthesisModel)}: ${errorMessage}`
      logger.error('Synthesis step failed', {
        conversationId,
        model: synthesisModel,
        error: errorMessage,
      })
    }

    if (nextFallbackModel) {
      logger.warn('Retrying synthesis with fallback model', {
        conversationId,
        failedModel: synthesisModel,
        fallbackModel: nextFallbackModel,
      })
    }
  }

  const failureReason = lastFailureReason ?? 'Synthesis failed.'
  logger.error('Synthesis step failed for all models', {
    conversationId,
    models: synthesisModels,
    failureReason,
  })
  return { success: false, failureReason }
}

function buildSynthesisPrompt(
  userRequest: string,
  assistantMessages: Message[],
  agents: WaggleConfig['agents'],
): string {
  const summaries = assistantMessages.map((msg, i) => {
    const agentMeta = msg.metadata?.waggle
    const label = agentMeta?.agentLabel ?? agents[i % agents.length]?.label ?? `Agent ${String(i)}`
    const text = getMessageText(msg)
    // Truncate very long turns to keep synthesis prompt focused
    const truncated =
      text.length > FUNCTION_VALUE_3000
        ? `${text.slice(0, SLICE_ARG_2_VALUE_3000)}... [truncated]`
        : text
    return `### ${label} (Turn ${String(i + 1)}):\n${truncated}`
  })

  return [
    'You are a neutral synthesis agent. Your job is to produce a clear, structured summary of the Waggle mode collaboration that just took place.',
    '',
    `## Original User Request`,
    userRequest,
    '',
    '## Collaboration Transcript',
    ...summaries,
    '',
    '## Your Task',
    'Produce a concise synthesis of the collaboration above. Use the following structure:',
    '',
    '### Agreed',
    'Points both agents agreed on.',
    '',
    '### Disagreed',
    "Points of disagreement, with each side's reasoning.",
    '',
    '### Key Findings',
    'Important discoveries, insights, or conclusions from the collaboration.',
    '',
    '### Open Questions',
    'Unresolved questions or areas that need further investigation.',
    '',
    '### Recommendation',
    'Your recommended path forward based on the collaboration.',
    '',
    'Each agent ended their turn with a summary of their position. Build on those per-turn summaries.',
    'Be concise. Focus on substance over meta-commentary. Do not use tools — synthesize from the transcript above.',
  ].join('\n')
}

/** Safely extract a file path from a tool call's parsed input. */
function extractFilePath(input: unknown): string {
  if (input == null || typeof input !== 'object') return ''
  const path = 'path' in input ? input.path : 'filePath' in input ? input.filePath : ''
  return typeof path === 'string' ? path : ''
}
