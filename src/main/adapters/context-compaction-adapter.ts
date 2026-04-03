/**
 * ContextCompactionService adapter — Tier 2 LLM-based compaction.
 *
 * Implements the Codex-style compaction approach:
 * 1. Check if token estimate exceeds threshold
 * 2. Send conversation history + summarization prompt to LLM
 * 3. Build compacted message array from summary + recent messages
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  COMPACTION_THRESHOLD_RATIO,
  FULL_COMPACTION_USER_MESSAGE_BUDGET_TOKENS,
  type FullCompactionResult,
} from '../domain/compaction/compaction-types'
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokens,
} from '../domain/compaction/token-estimation'
import { createLogger } from '../logger'
import {
  type CompactionMessage,
  type CompactOptions,
  ContextCompactionService,
} from '../ports/context-compaction-service'

const logger = createLogger('context-compaction')

// ─── Summarization prompt ───────────────────────────────────

const COMPACTION_SYSTEM_PROMPT =
  'You are a context compaction assistant. Your only task is to produce a concise handoff summary.'

function buildSummarizationPrompt(customInstructions?: string): string {
  const base = `You are performing a context checkpoint. Create a detailed handoff summary for another LLM that will resume the current task.

Include:
- What the user originally asked for (quote key phrases verbatim)
- What has been accomplished so far (files modified, decisions made, key findings)
- What remains to be done (clear next steps)
- Any constraints, preferences, or important context that must be preserved

Be concise but thorough. Do NOT include raw file contents or tool outputs — only summarize key information from them.`

  if (customInstructions) {
    return `${base}\n\nAdditional preservation instructions from the user:\n${customInstructions}`
  }
  return base
}

const CONTEXT_SUMMARY_PREFIX = '[Context Summary from prior conversation]\n\n'

// ─── Helpers ────────────────────────────────────────────────

/**
 * Collect recent user messages up to a token budget (newest-first).
 * Returns them in chronological order.
 */
function collectRecentUserMessages(
  messages: readonly CompactionMessage[],
  budgetTokens: number,
): CompactionMessage[] {
  const collected: CompactionMessage[] = []
  let usedTokens = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'user') continue
    const tokens = estimateMessageTokens(msg)
    if (usedTokens + tokens > budgetTokens) break
    collected.unshift(msg)
    usedTokens += tokens
  }

  return collected
}

/**
 * Extract the last assistant message (if any) to preserve continuity.
 */
function getLastAssistantMessage(
  messages: readonly CompactionMessage[],
): CompactionMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') return messages[i]
  }
  return undefined
}

/**
 * Collect summary text from a compaction LLM stream.
 */
async function collectStreamText(
  stream: AsyncIterable<import('@shared/types/stream').AgentStreamChunk>,
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      text += chunk.delta
    }
  }
  return text
}

// ─── Service implementation ─────────────────────────────────

export const ContextCompactionLive = Layer.succeed(ContextCompactionService, {
  needsFullCompaction: (messages, contextWindowTokens) =>
    Effect.sync(() => {
      const estimated = estimateMessagesTokens(messages)
      const threshold = contextWindowTokens * COMPACTION_THRESHOLD_RATIO
      return estimated > threshold
    }),

  compact: (options: CompactOptions) =>
    Effect.gen(function* () {
      const { messages, contextWindowTokens, customInstructions, chatStream, adapter } = options
      const originalTokenEstimate = estimateMessagesTokens(messages)

      logger.info('Starting full context compaction', {
        originalTokenEstimate,
        messageCount: messages.length,
        contextWindowTokens,
      })

      // Build the summarization request: full history + summarization prompt
      const summarizationMessages: CompactionMessage[] = [
        ...messages,
        { role: 'user', content: buildSummarizationPrompt(customInstructions) },
      ]

      // Call the LLM for summarization
      const stream = chatStream({
        adapter,
        messages: summarizationMessages,
        systemPrompts: [COMPACTION_SYSTEM_PROMPT],
        samplingOptions: { maxTokens: 4096 },
      })

      const summaryText = yield* Effect.tryPromise({
        try: () => collectStreamText(stream),
        catch: (err) =>
          new Error(
            `Context compaction LLM call failed: ${err instanceof Error ? err.message : 'unknown'}`,
          ),
      })

      if (!summaryText.trim()) {
        logger.warn('Compaction LLM returned empty summary, keeping original messages')
        return {
          messages: [...messages],
          result: {
            tier: 'full' as const,
            originalTokenEstimate,
            compactedTokenEstimate: originalTokenEstimate,
            summaryTokens: 0,
            recentMessagesPreserved: messages.length,
          },
        }
      }

      // Build compacted message array
      const summaryMessage: CompactionMessage = {
        role: 'user',
        content: `${CONTEXT_SUMMARY_PREFIX}${summaryText}`,
      }

      const recentUserMessages = collectRecentUserMessages(
        messages,
        FULL_COMPACTION_USER_MESSAGE_BUDGET_TOKENS,
      )

      const lastAssistant = getLastAssistantMessage(messages)

      const compactedMessages: CompactionMessage[] = [summaryMessage]

      // Preserve the last assistant message and its paired tool results
      // (they're needed for the assistant's tool calls to remain valid)
      if (lastAssistant) {
        compactedMessages.push(lastAssistant)
        if (lastAssistant.toolCalls) {
          const lastAssistantToolCallIds = new Set(lastAssistant.toolCalls.map((tc) => tc.id))
          for (const msg of messages) {
            if (
              msg.role === 'tool' &&
              msg.toolCallId &&
              lastAssistantToolCallIds.has(msg.toolCallId)
            ) {
              compactedMessages.push(msg)
            }
          }
        }
      }

      // Add recent user messages (avoiding duplicates with summary)
      for (const userMsg of recentUserMessages) {
        if (!compactedMessages.includes(userMsg)) {
          compactedMessages.push(userMsg)
        }
      }

      const compactedTokenEstimate = estimateMessagesTokens(compactedMessages)
      const summaryTokens = estimateTokens(summaryText)

      const result: FullCompactionResult = {
        tier: 'full',
        originalTokenEstimate,
        compactedTokenEstimate,
        summaryTokens,
        recentMessagesPreserved: compactedMessages.length,
      }

      logger.info('Context compaction completed', {
        originalTokenEstimate,
        compactedTokenEstimate,
        summaryTokens,
        messagesPreserved: compactedMessages.length,
        reductionPercent: Math.round(
          ((originalTokenEstimate - compactedTokenEstimate) / originalTokenEstimate) * 100,
        ),
      })

      return { messages: compactedMessages, result }
    }),
})
