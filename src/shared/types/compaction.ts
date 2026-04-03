// Shared compaction types used by both main process and renderer.

/** Lifecycle stage of a compaction operation. */
export type CompactionStage = 'starting' | 'summarizing' | 'completed' | 'failed'

/** Which compaction tier was applied. */
export type CompactionTier = 'micro' | 'full'
