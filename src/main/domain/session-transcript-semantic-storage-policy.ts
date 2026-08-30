export const SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY = {
  scopeTtlMs: 7 * 24 * 60 * 60 * 1_000,
  leaseTtlMs: 60 * 60 * 1_000,
  totalNodeLimit: 50_000,
  vectorByteLimit: 64 * 1_024 * 1_024,
  queuedNodeLimit: 10_000,
  perSessionNodeLimit: 5_000,
} as const

export type SessionTranscriptSemanticCoverageLimitReason =
  | 'per-session-node-limit'
  | 'storage-budget'
  | 'per-session-node-limit-and-storage-budget'
