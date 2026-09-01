const STANDARD_SESSION_COUNT = 100_000
const STANDARD_MESSAGE_COUNT = 10_000_000
const STANDARD_SKEWED_SESSION_MESSAGE_COUNT = 10_000
const STANDARD_PROJECT_COUNT = 1_000
const STANDARD_CUTOVER_LIMIT_MS = 900_000
const STANDARD_DISCOVERY_BACKFILL_LIMIT_MS = 180_000
const STANDARD_TRANSCRIPT_BACKFILL_LIMIT_MS = 180_000
const SMOKE_SESSION_COUNT = 1_000
const SMOKE_MESSAGE_COUNT = 100_000
const SMOKE_SKEWED_SESSION_MESSAGE_COUNT = 1_000
const SMOKE_PROJECT_COUNT = 100
const SMOKE_CUTOVER_LIMIT_MS = 60_000
const SMOKE_DISCOVERY_BACKFILL_LIMIT_MS = 30_000
const SMOKE_TRANSCRIPT_BACKFILL_LIMIT_MS = 30_000

export function sessionDiscoveryBenchmarkMode(arguments_: readonly string[]) {
  if (arguments_.includes('--smoke')) {
    return {
      name: 'smoke',
      sessionCount: SMOKE_SESSION_COUNT,
      messageCount: SMOKE_MESSAGE_COUNT,
      skewedSessionMessageCount: SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
      projectCount: SMOKE_PROJECT_COUNT,
      cutoverLimitMs: SMOKE_CUTOVER_LIMIT_MS,
      discoveryBackfillLimitMs: SMOKE_DISCOVERY_BACKFILL_LIMIT_MS,
      transcriptBackfillLimitMs: SMOKE_TRANSCRIPT_BACKFILL_LIMIT_MS,
    } as const
  }
  if (arguments_.includes('--query-scale')) {
    return {
      name: 'query-scale',
      sessionCount: STANDARD_SESSION_COUNT,
      messageCount: STANDARD_SESSION_COUNT,
      skewedSessionMessageCount: SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
      projectCount: STANDARD_PROJECT_COUNT,
      cutoverLimitMs: STANDARD_CUTOVER_LIMIT_MS,
      discoveryBackfillLimitMs: STANDARD_DISCOVERY_BACKFILL_LIMIT_MS,
      transcriptBackfillLimitMs: STANDARD_TRANSCRIPT_BACKFILL_LIMIT_MS,
    } as const
  }
  return {
    name: 'standard',
    sessionCount: STANDARD_SESSION_COUNT,
    messageCount: STANDARD_MESSAGE_COUNT,
    skewedSessionMessageCount: STANDARD_SKEWED_SESSION_MESSAGE_COUNT,
    projectCount: STANDARD_PROJECT_COUNT,
    cutoverLimitMs: STANDARD_CUTOVER_LIMIT_MS,
    discoveryBackfillLimitMs: STANDARD_DISCOVERY_BACKFILL_LIMIT_MS,
    transcriptBackfillLimitMs: STANDARD_TRANSCRIPT_BACKFILL_LIMIT_MS,
  } as const
}
