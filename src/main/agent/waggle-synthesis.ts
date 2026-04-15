import { WAGGLE_TIMEOUT } from '@shared/constants/timeouts'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { getMessageText } from '@shared/types/agent'
import {
  type ConversationId,
  createSkipApprovalToken,
  type SupportedModelId,
} from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
import { createLogger } from '../logger'
import type { ChatStreamOptions } from '../ports/chat-service'
import { runAgent } from './agent-loop'
import { makeMessage } from './shared'
import type { WaggleFileCache } from './waggle-file-cache'

const SYNTHESIS_PROMPT_TRUNCATION_LENGTH = 3000

const logger = createLogger('waggle-synthesis')

export interface SynthesisStepResult {
  readonly success: boolean
  readonly failureReason?: string
}

export interface SynthesisParams {
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

export function buildSynthesisModelCandidates(
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

export async function runSynthesisStep(params: SynthesisParams): Promise<SynthesisStepResult> {
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
        stallTimeoutMs: WAGGLE_TIMEOUT.STALL_MS,
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
      text.length > SYNTHESIS_PROMPT_TRUNCATION_LENGTH
        ? `${text.slice(0, SYNTHESIS_PROMPT_TRUNCATION_LENGTH)}... [truncated]`
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
