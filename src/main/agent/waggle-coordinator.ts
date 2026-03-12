import { DOUBLE_FACTOR } from '@shared/constants/constants'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { getMessageText, isToolCallPart } from '@shared/types/agent'
import { type ConversationId, createSkipApprovalToken } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import type { StreamChunk } from '@tanstack/ai'
import { createLogger } from '../logger'
import { runAgent } from './agent-loop'
import { checkConsensus } from './consensus-detector'
import { FileConflictTracker } from './file-conflict-tracker'
import { makeMessage } from './shared'

const SLICE_ARG_2 = 200
const RUN_WAGGLE_SEQUENTIAL_VALUE_20 = 20
const FUNCTION_VALUE_3000 = 3000
const SLICE_ARG_2_VALUE_3000 = 3000

const logger = createLogger('waggle')

export interface WaggleRunParams {
  readonly conversationId: ConversationId
  readonly conversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly config: WaggleConfig
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly onStreamChunk: (chunk: StreamChunk, meta: WaggleStreamMetadata) => void
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
      turnNumber,
      agentIndex,
      agentLabel: agent.label,
    })

    const meta: WaggleStreamMetadata = {
      agentIndex,
      agentLabel: agent.label,
      agentColor: agent.color,
      agentModel: agent.model,
      turnNumber,
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
        skipApproval: createSkipApprovalToken(),
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

      // Tag assistant message with Waggle metadata.
      const taggedMessage = makeMessage('assistant', [...assistantMsg.parts], assistantMsg.model, {
        ...assistantMsg.metadata,
        waggle: {
          agentIndex,
          agentLabel: agent.label,
          agentColor: agent.color,
          agentModel: agent.model,
          turnNumber,
        },
      })

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
        turnNumber,
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
            totalTurns: turnNumber + 1,
          })
          logger.info('Consensus reached', {
            conversationId,
            turnNumber: turnNumber + 1,
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
  if (successfulAssistantMsgs.length >= DOUBLE_FACTOR && status !== 'stopped' && !signal.aborted) {
    await runSynthesisStep({
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
    })
  }

  const totalTurns = accumulatedMessages.filter(
    (m) => m.role === 'assistant' && !m.metadata?.waggle?.isSynthesis,
  ).length
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
  readonly accumulatedMessages: Message[]
  readonly successfulAssistantMsgs: Message[]
  readonly onStreamChunk: (chunk: StreamChunk, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly onTurnComplete?: (accumulatedMessages: readonly Message[]) => Promise<void>
}

async function runSynthesisStep(params: SynthesisParams): Promise<void> {
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
  } = params

  // Use Agent A's model for synthesis
  const synthesisModel = agents[0].model
  const synthesisTurnNumber = successfulAssistantMsgs.length

  logger.info('Starting synthesis step', {
    conversationId,
    model: synthesisModel,
    debateTurns: successfulAssistantMsgs.length,
  })

  onTurnEvent({ type: 'synthesis-start' })

  const synthesisMeta: WaggleStreamMetadata = {
    agentIndex: -1,
    agentLabel: 'Synthesis',
    agentColor: 'emerald',
    agentModel: synthesisModel,
    turnNumber: synthesisTurnNumber,
    collaborationMode: 'sequential',
    isSynthesis: true,
  }

  const synthesisPrompt = buildSynthesisPrompt(payload.text, successfulAssistantMsgs, agents)

  const synthesisPayload: HydratedAgentSendPayload = {
    ...payload,
    text: synthesisPrompt,
    attachments: [],
  }

  try {
    const result = await runAgent({
      conversation: workingConversation,
      payload: synthesisPayload,
      model: synthesisModel,
      settings,
      skipApproval: createSkipApprovalToken(),
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
      const taggedSynthesis = makeMessage(
        'assistant',
        [...assistantMsg.parts],
        assistantMsg.model,
        {
          ...assistantMsg.metadata,
          waggle: {
            agentIndex: -1,
            agentLabel: 'Synthesis',
            agentColor: 'emerald',
            agentModel: synthesisModel,
            turnNumber: synthesisTurnNumber,
            isSynthesis: true,
          },
        },
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

      logger.info('Synthesis step completed', { conversationId })
    } else {
      logger.warn('Synthesis step produced no output', { conversationId })
    }
  } catch (err) {
    // Don't fail the whole collaboration if synthesis fails
    if (signal.aborted || (err instanceof Error && err.message === 'aborted')) {
      return
    }
    logger.error('Synthesis step failed', {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
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
    'Be concise. Focus on substance over meta-commentary. Do not use tools — synthesize from the transcript above.',
  ].join('\n')
}

/** Safely extract a file path from a tool call's parsed input. */
function extractFilePath(input: unknown): string {
  if (input == null || typeof input !== 'object') return ''
  const path = 'path' in input ? input.path : 'filePath' in input ? input.filePath : ''
  return typeof path === 'string' ? path : ''
}
