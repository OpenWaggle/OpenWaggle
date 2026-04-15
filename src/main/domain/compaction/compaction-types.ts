// Domain types for context compaction — zero infrastructure imports.
// Configuration constants live in @shared/constants/context-config.ts.

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
