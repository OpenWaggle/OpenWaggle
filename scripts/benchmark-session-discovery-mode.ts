const STANDARD_SESSION_COUNT = 100_000
const STANDARD_MESSAGE_COUNT = 10_000_000
const STANDARD_SKEWED_SESSION_MESSAGE_COUNT = 10_000
const STANDARD_PROJECT_COUNT = 1_000
const STANDARD_CUTOVER_LIMIT_MS = 900_000
const STANDARD_DISCOVERY_BACKFILL_LIMIT_MS = 180_000
const STANDARD_TRANSCRIPT_BACKFILL_LIMIT_MS = 180_000
const MIGRATION_SCALE_MESSAGE_COUNT = 1_000_000
const MIGRATION_SCALE_CUTOVER_LIMIT_MS = 180_000
const SMOKE_SESSION_COUNT = 1_000
const SMOKE_MESSAGE_COUNT = 100_000
const SMOKE_SKEWED_SESSION_MESSAGE_COUNT = 1_000
const SMOKE_PROJECT_COUNT = 100
const SMOKE_CUTOVER_LIMIT_MS = 60_000
const SMOKE_DISCOVERY_BACKFILL_LIMIT_MS = 30_000
const SMOKE_TRANSCRIPT_BACKFILL_LIMIT_MS = 30_000
const BYTES_PER_MEBIBYTE = 1_048_576
const DATABASE_FIXED_BUDGET_MB = 256
const DATABASE_BYTES_PER_SESSION = 2_048
const DATABASE_BYTES_PER_MESSAGE = 3_072

/** Linear storage envelope for rows, indexes, FTS postings, and bounded semantic vectors. */
export function sessionDiscoveryDatabaseSizeLimitMb(
  sessionCount: number,
  messageCount: number,
) {
  return Math.ceil(
    DATABASE_FIXED_BUDGET_MB +
      (sessionCount * DATABASE_BYTES_PER_SESSION + messageCount * DATABASE_BYTES_PER_MESSAGE) /
        BYTES_PER_MEBIBYTE,
  )
}

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
      databaseSizeLimitMb: sessionDiscoveryDatabaseSizeLimitMb(
        SMOKE_SESSION_COUNT,
        SMOKE_MESSAGE_COUNT + SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
      ),
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
      databaseSizeLimitMb: sessionDiscoveryDatabaseSizeLimitMb(
        STANDARD_SESSION_COUNT,
        STANDARD_SESSION_COUNT + SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
      ),
    } as const
  }
  if (arguments_.includes('--migration-scale')) {
    return {
      name: 'migration-scale',
      sessionCount: STANDARD_SESSION_COUNT,
      messageCount: MIGRATION_SCALE_MESSAGE_COUNT,
      skewedSessionMessageCount: STANDARD_SKEWED_SESSION_MESSAGE_COUNT,
      projectCount: STANDARD_PROJECT_COUNT,
      cutoverLimitMs: MIGRATION_SCALE_CUTOVER_LIMIT_MS,
      discoveryBackfillLimitMs: STANDARD_DISCOVERY_BACKFILL_LIMIT_MS,
      transcriptBackfillLimitMs: STANDARD_TRANSCRIPT_BACKFILL_LIMIT_MS,
      databaseSizeLimitMb: sessionDiscoveryDatabaseSizeLimitMb(
        STANDARD_SESSION_COUNT,
        MIGRATION_SCALE_MESSAGE_COUNT + STANDARD_SKEWED_SESSION_MESSAGE_COUNT,
      ),
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
    databaseSizeLimitMb: sessionDiscoveryDatabaseSizeLimitMb(
      STANDARD_SESSION_COUNT,
      STANDARD_MESSAGE_COUNT + STANDARD_SKEWED_SESSION_MESSAGE_COUNT,
    ),
  } as const
}
