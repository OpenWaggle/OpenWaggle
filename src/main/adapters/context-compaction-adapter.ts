/**
 * ContextCompactionService adapter — Tier 2 LLM-based compaction.
 *
 * Implements the Codex-style compaction approach:
 * 1. Check if token estimate exceeds threshold
 * 2. Send conversation history + summarization prompt to LLM
 * 3. Build compacted message array from summary + recent messages
 */
import type { AgentStreamChunk } from '@shared/types/stream'
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

const PERCENT_MULTIPLIER = 100
const COMPACTION_SUMMARY_MAX_TOKENS = 4096

const COMPACTION_SYSTEM_PROMPT =
  'You are a context compaction assistant. Your only task is to produce a concise handoff summary.'

function buildSummarizationPrompt(
  customInstructions?: string,
  pinnedContent?: readonly string[],
): string {
  const base = `You are performing a context checkpoint. Create a detailed handoff summary for another LLM that will resume the current task.

Include:
- What the user originally asked for (quote key phrases verbatim)
- What has been accomplished so far (files modified, decisions made, key findings)
- What remains to be done (clear next steps)
- Any constraints, preferences, or important context that must be preserved

Be concise but thorough. Do NOT include raw file contents or tool outputs — only summarize key information from them.`

  const parts = [base]

  if (pinnedContent && pinnedContent.length > 0) {
    parts.push(
      `\nThe following content has been pinned by the user and MUST be preserved verbatim in the summary:\n${pinnedContent.map((c, i) => `[Pin ${String(i + 1)}] ${c}`).join('\n')}`,
    )
  }

  if (customInstructions) {
    parts.push(`\nAdditional preservation instructions from the user:\n${customInstructions}`)
  }

  return parts.join('\n')
}

const CONTEXT_SUMMARY_PREFIX = '[Context Summary from prior conversation]\n\n'

// ─── Helpers ────────────────────────────────────────────────

/**
 * Collect the newest contiguous block of user messages that fits within
 * the token budget. Iterates newest-first and stops at the first message
 * that would exceed the budget — intentionally preserving recency over
 * completeness so the most recent user context is always kept.
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

/** Timeout for the compaction summarization stream (2 minutes). */
const COMPACTION_STREAM_TIMEOUT_MS = 120_000

/**
 * Collect summary text from a compaction LLM stream with stall protection.
 * Uses manual iterator + Promise.race to avoid blocking indefinitely
 * on provider stalls (same pattern as the main agent stream processor).
 */
async function collectStreamText(stream: AsyncIterable<AgentStreamChunk>): Promise<string> {
  let text = ''
  const iterator = stream[Symbol.asyncIterator]()

  while (true) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Compaction stream stalled — no chunks received within timeout')),
        COMPACTION_STREAM_TIMEOUT_MS,
      )
      // Allow Node to exit even if the timer is pending
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    })

    const result = await Promise.race([iterator.next(), timeoutPromise])
    if (result.done) break
    if (result.value.type === 'TEXT_MESSAGE_CONTENT') {
      text += result.value.delta
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
      const {
        messages,
        contextWindowTokens,
        customInstructions,
        pinnedContent,
        chatStream,
        adapter,
      } = options
      const originalTokenEstimate = estimateMessagesTokens(messages)

      logger.info('Starting full context compaction', {
        originalTokenEstimate,
        messageCount: messages.length,
        contextWindowTokens,
      })

      // Build the summarization request: full history + summarization prompt
      const summarizationMessages: CompactionMessage[] = [
        ...messages,
        { role: 'user', content: buildSummarizationPrompt(customInstructions, pinnedContent) },
      ]

      // Call the LLM for summarization
      const stream = chatStream({
        adapter,
        messages: summarizationMessages,
        systemPrompts: [COMPACTION_SYSTEM_PROMPT],
        samplingOptions: { maxTokens: COMPACTION_SUMMARY_MAX_TOKENS },
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

      // Extreme pressure check: if compacted result still exceeds 95% of context
      // and pinned content exists, the pinned content was preserved verbatim.
      // As a last resort, flag that pinned content was included in summarization.
      const EXTREME_PRESSURE_RATIO = 0.95
      const postCompactionRatio = compactedTokenEstimate / contextWindowTokens
      const hasPinnedContent = pinnedContent && pinnedContent.length > 0
      const pinnedContentSummarized =
        postCompactionRatio > EXTREME_PRESSURE_RATIO && hasPinnedContent

      if (pinnedContentSummarized) {
        logger.warn('Extreme context pressure — pinned content was included in summarization', {
          postCompactionRatio: Math.round(postCompactionRatio * PERCENT_MULTIPLIER),
          pinnedItemCount: pinnedContent.length,
        })
      }

      const finalResult: FullCompactionResult = {
        ...result,
        pinnedContentSummarized: pinnedContentSummarized || undefined,
      }

      logger.info('Context compaction completed', {
        originalTokenEstimate,
        compactedTokenEstimate,
        summaryTokens,
        messagesPreserved: compactedMessages.length,
        reductionPercent: Math.round(
          ((originalTokenEstimate - compactedTokenEstimate) / originalTokenEstimate) *
            PERCENT_MULTIPLIER,
        ),
        pinnedContentSummarized,
      })

      return { messages: compactedMessages, result: finalResult }
    }),
})
