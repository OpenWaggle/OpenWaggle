import type {
  UsageCostDay,
  UsageCostModelRow,
  UsageCostProjectRow,
  UsageCostQuery,
  UsageCostSessionOrigin,
  UsageCostSessionQuery,
  UsageCostSessionRow,
  UsageCostTokens,
  UsageCostView,
} from '@shared/types/usage-cost'

/**
 * Pure Usage & Cost aggregation over scanned Pi session records. No I/O here:
 * the adapter produces `UsageCostScanSession`s, this module answers queries.
 */

export interface UsageCostRecordTokens {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface UsageCostRecord {
  readonly timestampMs: number
  readonly provider: string
  readonly modelId: string
  readonly tokens: UsageCostRecordTokens
  readonly totalTokens: number
  /** Cost Pi wrote into the session record, or `null` when absent. */
  readonly recordedCostUsd: number | null
  /** Cost computed from Pi's own model rates when the record carried none. */
  readonly estimatedCostUsd: number | null
}

export interface UsageCostScanSession {
  readonly file: string
  readonly sessionId: string | null
  readonly cwd: string | null
  readonly origin: UsageCostSessionOrigin
  readonly startedAtMs: number | null
  readonly lastActivityMs: number | null
  readonly records: readonly UsageCostRecord[]
}

export interface UsageCostScanStats {
  readonly scannedFiles: number
  readonly scannedFilesCached: number
  readonly scanDurationMs: number
}

const UNPRICED_MODEL_PROVIDER = 'pi'
const UNPRICED_MODEL_ID = 'tools/summaries'

export const USAGE_COST_TOOLS_MODEL_PROVIDER = UNPRICED_MODEL_PROVIDER
export const USAGE_COST_TOOLS_MODEL_ID = UNPRICED_MODEL_ID

function emptyTokens(): UsageCostTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

interface MutableTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

interface MutableBucket {
  tokens: MutableTokens
  recordedCostUsd: number
  estimatedCostUsd: number
  unpricedTokens: number
}

function newMutableBucket(): MutableBucket {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    recordedCostUsd: 0,
    estimatedCostUsd: 0,
    unpricedTokens: 0,
  }
}

function addTokens(target: MutableTokens, tokens: UsageCostRecordTokens): void {
  target.input += tokens.input
  target.output += tokens.output
  target.cacheRead += tokens.cacheRead
  target.cacheWrite += tokens.cacheWrite
}

function addRecord(bucket: MutableBucket, record: UsageCostRecord): void {
  addTokens(bucket.tokens, record.tokens)
  bucket.tokens.total += record.totalTokens
  if (record.recordedCostUsd !== null) {
    bucket.recordedCostUsd += record.recordedCostUsd
  } else if (record.estimatedCostUsd !== null) {
    bucket.estimatedCostUsd += record.estimatedCostUsd
  } else {
    bucket.unpricedTokens += record.totalTokens
  }
}

function recordMatchesOrigin(
  origin: UsageCostSessionOrigin,
  filter: UsageCostQuery['origin'],
): boolean {
  if (filter === 'all') return true
  return origin === filter
}

function recordInWindow(
  record: UsageCostRecord,
  rangeStartMs: number | null,
  rangeEndMs: number,
): boolean {
  if (record.timestampMs > rangeEndMs) return false
  if (rangeStartMs === null) return true
  return record.timestampMs >= rangeStartMs
}

/** Local-timezone `YYYY-MM-DD` key, so days match the user's calendar. */
export function localDayKey(timestampMs: number, now: Date): string {
  const offsetMs = now.getTimezoneOffset() * 60_000
  const shifted = new Date(timestampMs - offsetMs)
  return shifted.toISOString().slice(0, 10)
}

export function rangeStartForPreset(preset: UsageCostQuery['preset'], now: Date): number | null {
  if (preset === 'all') return null
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return now.getTime() - days * 24 * 60 * 60 * 1000
}

export interface AggregateUsageCostViewInput {
  readonly sessions: readonly UsageCostScanSession[]
  readonly stats: UsageCostScanStats
}

/**
 * Builds the Usage & Cost view for a query. Sessions whose records all fall
 * outside the window contribute nothing; drill-down `sessionCount` counts
 * sessions with at least one in-window record after the origin filter.
 */
export function aggregateUsageCostView(
  input: AggregateUsageCostViewInput,
  query: UsageCostQuery,
  now: Date,
): UsageCostView {
  const rangeStartMs = rangeStartForPreset(query.preset, now)
  const rangeEndMs = now.getTime()

  const totals = {
    tokens: emptyTokens(),
    recordedCostUsd: 0,
    estimatedCostUsd: 0,
    unpricedTokens: 0,
  }
  const dayBuckets = new Map<string, MutableBucket>()
  const modelBuckets = new Map<string, { row: UsageCostModelRow }>()
  const projectBuckets = new Map<string, { row: UsageCostProjectRow }>()
  let sessionCount = 0

  for (const session of input.sessions) {
    if (!recordMatchesOrigin(session.origin, query.origin)) continue
    let sessionHasRecords = false
    for (const record of session.records) {
      if (!recordInWindow(record, rangeStartMs, rangeEndMs)) continue
      sessionHasRecords = true
      addRecord(totals, record)

      const day = localDayKey(record.timestampMs, now)
      const dayBucket = dayBuckets.get(day) ?? newMutableBucket()
      addRecord(dayBucket, record)
      dayBuckets.set(day, dayBucket)

      const modelKey = `${record.provider}/${record.modelId}`
      const modelBucket = modelBuckets.get(modelKey) ?? {
        row: { provider: record.provider, modelId: record.modelId, ...newMutableBucket() },
      }
      addRecord(modelBucket.row, record)
      modelBuckets.set(modelKey, modelBucket)

      const projectKey = session.cwd ?? '\u0000null'
      const projectBucket = projectBuckets.get(projectKey) ?? {
        row: {
          cwd: session.cwd,
          label: session.cwd === null ? 'Unknown location' : leafDirectoryName(session.cwd),
          ...newMutableBucket(),
        },
      }
      addRecord(projectBucket.row, record)
      projectBuckets.set(projectKey, projectBucket)
    }
    if (sessionHasRecords) sessionCount += 1
  }

  const days: UsageCostDay[] = [...dayBuckets.entries()]
    .map(([day, bucket]) => ({ day, ...bucket }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const models: UsageCostModelRow[] = [...modelBuckets.values()]
    .map((entry) => entry.row)
    .sort((a, b) => b.tokens.total - a.tokens.total)

  const projects: UsageCostProjectRow[] = [...projectBuckets.values()]
    .map((entry) => entry.row)
    .sort((a, b) => b.tokens.total - a.tokens.total)

  return {
    query,
    generatedAtMs: now.getTime(),
    rangeStartMs,
    rangeEndMs,
    totals,
    unpricedShare: totals.tokens.total === 0 ? 0 : totals.unpricedTokens / totals.tokens.total,
    days,
    models,
    projects,
    sessionCount,
    scannedFiles: input.stats.scannedFiles,
    scannedFilesCached: input.stats.scannedFilesCached,
    scanDurationMs: input.stats.scanDurationMs,
  }
}

/**
 * Drill-down: the sessions behind the current filters, most recently active
 * first. Model/origin/day/cwd filters narrow sessions; a session matches when
 * at least one of its in-window records satisfies every dimension.
 */
export function selectUsageCostSessions(
  input: AggregateUsageCostViewInput,
  query: UsageCostSessionQuery,
  now: Date,
): UsageCostSessionRow[] {
  const rangeStartMs = rangeStartForPreset(query.preset, now)
  const rangeEndMs = now.getTime()

  const rows: UsageCostSessionRow[] = []
  for (const session of input.sessions) {
    if (!recordMatchesOrigin(session.origin, query.origin)) continue
    if (query.cwd !== undefined && session.cwd !== query.cwd) continue
    const buckets = new Map<string, MutableBucket>()
    let lastActivityMs: number | null = null
    for (const record of session.records) {
      if (!recordInWindow(record, rangeStartMs, rangeEndMs)) continue
      if (query.provider !== undefined && record.provider !== query.provider) continue
      if (query.modelId !== undefined && record.modelId !== query.modelId) continue
      if (query.day !== undefined && localDayKey(record.timestampMs, now) !== query.day) continue
      const dayKey = localDayKey(record.timestampMs, now)
      const bucket = buckets.get(dayKey) ?? {
        tokens: emptyTokens(),
        recordedCostUsd: 0,
        estimatedCostUsd: 0,
        unpricedTokens: 0,
      }
      addRecord(bucket, record)
      buckets.set(dayKey, bucket)
      lastActivityMs =
        lastActivityMs === null ? record.timestampMs : Math.max(lastActivityMs, record.timestampMs)
    }
    if (buckets.size === 0) continue
    const merged = newMutableBucket()
    for (const bucket of buckets.values()) {
      addTokens(merged.tokens, bucket.tokens)
      merged.tokens.total += bucket.tokens.total
      merged.recordedCostUsd += bucket.recordedCostUsd
      merged.estimatedCostUsd += bucket.estimatedCostUsd
      merged.unpricedTokens += bucket.unpricedTokens
    }
    rows.push({
      sessionId: session.sessionId,
      file: session.file,
      cwd: session.cwd,
      origin: session.origin,
      startedAtMs: session.startedAtMs,
      lastActivityMs: lastActivityMs ?? session.lastActivityMs,
      ...merged,
    })
  }
  return rows.sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0))
}

function leafDirectoryName(cwd: string): string {
  const trimmed = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}
