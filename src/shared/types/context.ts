// Shared context types used by both main process and renderer.
// These types define the canonical context snapshot, pinned context,
// model compatibility, and compaction event data.

import { CONTEXT_HEALTH } from '@shared/constants/context-config'
import type { ConversationId, MessageId, SupportedModelId } from './brand'
import type { CompactionTier } from './compaction'

// ─── Context Snapshot ───────────────────────────────────────

/** Health status derived from context usage ratio. */
export type ContextHealthStatus = 'comfortable' | 'tight' | 'critical' | 'blocked'

/** How the usedTokens value was derived. */
export type ContextSnapshotSource =
  | 'run-finished'
  | 'estimate'
  | 'compaction'
  | 'model-switch'
  | 'pin-change'
  | 'waggle-change'

/** Context window metadata for a specific model. */
export interface ModelContextWindow {
  readonly contextTokens: number
  readonly maxOutputTokens: number
}

/** Last compaction event summary. */
export interface LastCompactionInfo {
  readonly timestamp: number
  readonly type: 'automatic' | 'manual'
  readonly messagesSummarized: number
  readonly tokensBefore: number
  readonly tokensAfter: number
}

/** Waggle context state when waggle mode is active. */
export interface WaggleContextInfo {
  readonly activeModels: readonly WaggleModelEntry[]
  readonly governingModelId: SupportedModelId
  readonly effectiveBudget: number
}

/** A participating model in a waggle session. */
export interface WaggleModelEntry {
  readonly modelId: SupportedModelId
  readonly displayName: string
  readonly contextWindow: number
}

/**
 * Canonical context snapshot — produced by main process, consumed by renderer.
 * Main process is the single source of truth; renderer treats this as read-only.
 */
export interface ContextSnapshot {
  // Primary metric
  readonly usedTokens: number
  readonly contextWindow: number
  readonly maxOutputTokens: number

  // Source tracking
  readonly source: ContextSnapshotSource

  // Model info
  readonly modelId: SupportedModelId
  readonly modelDisplayName: string

  // Pinned context breakdown
  readonly pinnedTokens: number
  readonly pinnedItemCount: number
  /** Message IDs that are currently pinned. Used by chat bubbles to show pin state. */
  readonly pinnedMessageIds: readonly string[]

  // Microcompaction (Tier 1) — tool results cleared this session
  readonly microcompactedToolResults?: number

  // Compaction state
  readonly lastCompaction: LastCompactionInfo | null

  // Waggle (when active)
  readonly waggle: WaggleContextInfo | null

  // Derived health
  readonly healthStatus: ContextHealthStatus
}

// ─── Health Status Computation ──────────────────────────────

/** Compute health status from usage ratio. */
export function computeHealthStatus(
  usedTokens: number,
  contextWindow: number,
  maxOutputTokens: number,
): ContextHealthStatus {
  const effectiveBudget = contextWindow - maxOutputTokens
  if (effectiveBudget <= 0) return 'blocked'
  const ratio = usedTokens / effectiveBudget
  if (ratio < CONTEXT_HEALTH.COMFORTABLE_THRESHOLD) return 'comfortable'
  if (ratio < CONTEXT_HEALTH.TIGHT_THRESHOLD) return 'tight'
  if (ratio < CONTEXT_HEALTH.CRITICAL_THRESHOLD) return 'critical'
  return 'blocked'
}

// ─── Model Compatibility ────────────────────────────────────

/** Compatibility status when considering switching to a model. */
export type ModelSwitchCompatibility = 'comfortable' | 'tight-fit' | 'would-compact' | 'blocked'

/** Compatibility info for a single model relative to current thread context. */
export interface ModelCompatibilityInfo {
  readonly modelId: SupportedModelId
  readonly displayName: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly compatibility: ModelSwitchCompatibility
}

// ─── Pinned Context ─────────────────────────────────────────

/** Type of pinned context item. */
export type PinnedItemType = 'instruction' | 'message'

/** A pinned context item persisted in SQLite. */
export interface PinnedItem {
  readonly id: string
  readonly conversationId: ConversationId
  readonly type: PinnedItemType
  readonly content: string
  readonly messageId: MessageId | undefined
  readonly createdAt: number
}

/** Payload for adding a new pinned item (id and createdAt are generated server-side). */
export interface PinnedItemInput {
  readonly type: PinnedItemType
  readonly content: string
  readonly messageId?: MessageId
}

// ─── Compaction Event Data ──────────────────────────────────

/** Metrics attached to a compaction event. */
export interface CompactionEventMetrics {
  readonly tokensBefore: number
  readonly tokensAfter: number
  readonly messagesSummarized: number
}

/** Data stored in a CompactionEventPart (system message in timeline). */
export interface CompactionEventData {
  readonly tier: CompactionTier
  readonly trigger: 'automatic' | 'manual'
  readonly description: string
  readonly metrics?: CompactionEventMetrics
  readonly timestamp: number
  /** True when pinned content was summarized due to extreme context pressure. */
  readonly pinnedContentSummarized?: boolean
}
