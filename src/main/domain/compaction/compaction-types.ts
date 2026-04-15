// Domain types for context compaction — zero infrastructure imports.

import type { CompactionStage, CompactionTier } from '@shared/types/compaction'
import type { ModelContextWindow } from '@shared/types/context'

export type { CompactionStage, CompactionTier, ModelContextWindow }

/** Result of a Tier 1 microcompaction pass (deterministic, no LLM). */
export interface MicrocompactionResult {
  readonly tier: 'micro'
  readonly originalTokenEstimate: number
  readonly compactedTokenEstimate: number
  readonly toolResultsStripped: number
}

/** Result of a Tier 2 full LLM compaction pass. */
export interface FullCompactionResult {
  readonly tier: 'full'
  readonly originalTokenEstimate: number
  readonly compactedTokenEstimate: number
  readonly summaryTokens: number
  readonly recentMessagesPreserved: number
  /** True when pinned content was included in summarization due to extreme pressure. */
  readonly pinnedContentSummarized?: boolean
}

/** Discriminated union of compaction outcomes. */
export type CompactionResult = MicrocompactionResult | FullCompactionResult

/** Event emitted via CUSTOM stream chunks to notify the renderer. */
export interface CompactionEvent {
  readonly stage: CompactionStage
  readonly tier: CompactionTier
  readonly description: string
  readonly errorMessage?: string
  readonly metrics?: {
    readonly tokensBefore: number
    readonly tokensAfter: number
    readonly messagesSummarized: number
  }
}

/**
 * Default context window assumed when a provider does not report one.
 * 128K tokens is a safe conservative value — most modern models support at least this.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

/**
 * Compaction threshold as a fraction of the context window.
 * Full compaction triggers when estimated tokens exceed this ratio.
 * Set at 90% to preserve as much context as possible while leaving
 * headroom for replies and tool output.
 */
export const COMPACTION_THRESHOLD_RATIO = 0.9

/**
 * Number of most recent tool results to preserve during microcompaction.
 * Older tool results are replaced with compact placeholders.
 */
export const MICRO_RECENT_TOOL_RESULTS = 5

/**
 * Tighter tool result preservation count for Waggle mode between-turn compaction.
 * Waggle turns are shorter and agents can re-read files via WaggleFileCache.
 */
export const WAGGLE_MICRO_RECENT_TOOL_RESULTS = 3

/**
 * Maximum token budget for recent user messages preserved after full compaction.
 * Newest user messages are kept up to this budget; older ones are dropped.
 */
export const FULL_COMPACTION_USER_MESSAGE_BUDGET_TOKENS = 20_000
