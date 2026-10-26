import type {
  UsageCostDay,
  UsageCostModelRow,
  UsageCostProjectRow,
  UsageCostQuery,
  UsageCostSessionOrigin,
  UsageCostSessionQuery,
  UsageCostSessionRow,
  UsageCostView,
} from '@shared/types/usage-cost'
import type { UsageCostRecord, UsageCostRecordTokens } from './usage-cost-record'

export type { UsageCostRecord, UsageCostRecordTokens } from './usage-cost-record'

/**
 * Pure Usage & Cost aggregation over scanned Pi session records. No I/O here:
 * the adapter produces `UsageCostScanSession`s, this module answers queries.
 */

export interface UsageCostScanSession {
  readonly file: string
  readonly sessionId: string | null
  /** The latest Pi `/name`, else the first prompt, shortened; `null` when there is neither. */
  readonly title: string | null
  readonly cwd: string | null
  /** Owning project resolved from the cwd (a git worktree's primary repository, a temporary root, a known project), or `null` when the cwd stands alone. */
  readonly resolvedProjectPath: string | null
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

const MS_PER_MINUTE = 60_000
const ISO_DATE_LENGTH = 10
const MS_PER_DAY = 24 * 60 * 60 * 1000
const SEVEN_DAY_WINDOW = 7
const THIRTY_DAY_WINDOW = 30
const NINETY_DAY_WINDOW = 90

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

function addTokens(target: MutableTokens, tokens: UsageCostRecordTokens) {
  target.input += tokens.input
  target.output += tokens.output
  target.cacheRead += tokens.cacheRead
  target.cacheWrite += tokens.cacheWrite
}

function addRecord(bucket: MutableBucket, record: UsageCostRecord) {
  addTokens(bucket.tokens, record.tokens)
  bucket.tokens.total += record.totalTokens
  if (record.recordedCostUsd !== null) {
    bucket.recordedCostUsd += record.recordedCostUsd
    return
  }
  if (record.estimatedCostUsd !== null) {
    bucket.estimatedCostUsd += record.estimatedCostUsd
    return
  }
  bucket.unpricedTokens += record.totalTokens
}

function recordMatchesOrigin(origin: UsageCostSessionOrigin, filter: UsageCostQuery['origin']) {
  if (filter === 'all') return true
  return origin === filter
}

function recordInWindow(record: UsageCostRecord, rangeStartMs: number | null, rangeEndMs: number) {
  if (record.timestampMs > rangeEndMs) return false
  if (rangeStartMs === null) return true
  return record.timestampMs >= rangeStartMs
}

/** Local-timezone `YYYY-MM-DD` key, so days match the user's calendar. */
export function localDayKey(timestampMs: number, now: Date): string {
  const offsetMs = now.getTimezoneOffset() * MS_PER_MINUTE
  const shifted = new Date(timestampMs - offsetMs)
  return shifted.toISOString().slice(0, ISO_DATE_LENGTH)
}

export function rangeStartForPreset(preset: UsageCostQuery['preset'], now: Date): number | null {
  if (preset === 'all') return null
  const days =
    preset === '7d' ? SEVEN_DAY_WINDOW : preset === '30d' ? THIRTY_DAY_WINDOW : NINETY_DAY_WINDOW
  return now.getTime() - days * MS_PER_DAY
}

export interface AggregateUsageCostViewInput {
  readonly sessions: readonly UsageCostScanSession[]
  readonly stats: UsageCostScanStats
  /** Display context the pure layer needs to render labels without exposing absolute paths. */
  readonly display: UsageCostDisplayContext
}

/** Display context for labels and privacy-aware paths, composed from settings in the handler. */
export interface UsageCostDisplayContext {
  /** The machine's home directory; paths under it are abbreviated to `~/…`. */
  readonly homePath: string
  /** Roots whose sessions group under the 'Temporary directory' label. */
  readonly temporaryRoots: readonly string[]
  /** OpenWaggle project display names by project path. */
  readonly displayNames: Readonly<Record<string, string>>
}

const NO_PROJECT_KEY = '\u0000null'
const TEMPORARY_DIRECTORY_LABEL = 'Temporary directory'
const UNKNOWN_LOCATION_LABEL = 'Unknown location'

function leafDirectoryName(directory: string) {
  const trimmed = directory.length > 1 ? directory.replace(/[/\\]+$/, '') : directory
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/** Privacy rule (CONTEXT.md: Usage & Cost view): never display a raw absolute path. */
function displayPath(directory: string, homePath: string) {
  if (homePath === '') return leafDirectoryName(directory)
  if (directory === homePath) return '~'
  for (const separator of ['/', '\\']) {
    const prefix = `${homePath}${separator}`
    if (directory.startsWith(prefix)) return `~/${directory.slice(prefix.length)}`
  }
  return leafDirectoryName(directory)
}

function projectIdentityFor(
  session: UsageCostScanSession,
  display: UsageCostDisplayContext,
): { readonly key: string; readonly label: string; readonly detail: string | null } {
  const key = session.resolvedProjectPath ?? session.cwd
  if (key === null) return { key: NO_PROJECT_KEY, label: UNKNOWN_LOCATION_LABEL, detail: null }
  if (display.temporaryRoots.includes(key)) {
    return { key, label: TEMPORARY_DIRECTORY_LABEL, detail: null }
  }
  return {
    key,
    label: display.displayNames[key] ?? leafDirectoryName(key),
    detail: displayPath(key, display.homePath),
  }
}

/**
 * Builds the Usage & Cost view for a query. Sessions whose records all fall
 * outside the window contribute nothing; `sessionCount` counts sessions with
 * at least one in-window record after the origin filter.
 */
export function aggregateUsageCostView(
  input: AggregateUsageCostViewInput,
  query: UsageCostQuery,
  now: Date,
): UsageCostView {
  const rangeStartMs = rangeStartForPreset(query.preset, now)
  const rangeEndMs = now.getTime()

  const totals = newMutableBucket()
  const dayBuckets = new Map<string, MutableBucket>()
  const modelBuckets = new Map<string, { row: UsageCostModelRow }>()
  const projectBuckets = new Map<string, { row: UsageCostProjectRow }>()
  let sessionCount = 0

  for (const session of input.sessions) {
    if (!recordMatchesOrigin(session.origin, query.origin)) continue
    const project = projectIdentityFor(session, input.display)
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

      const projectBucket = projectBuckets.get(project.key) ?? {
        row: {
          projectPath: session.cwd === null ? null : project.key,
          label: project.label,
          detail: project.detail,
          ...newMutableBucket(),
        },
      }
      addRecord(projectBucket.row, record)
      projectBuckets.set(project.key, projectBucket)
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
 * first. A session matches when at least one of its in-window records
 * satisfies every selected dimension.
 */
export function selectUsageCostSessions(
  input: AggregateUsageCostViewInput,
  query: UsageCostSessionQuery,
  now: Date,
): UsageCostSessionRow[] {
  const rows: UsageCostSessionRow[] = []
  for (const session of input.sessions) {
    const row = sessionRowForQuery(session, query, input.display, now)
    if (row !== null) rows.push(row)
  }
  return rows.sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0))
}

function sessionRowForQuery(
  session: UsageCostScanSession,
  query: UsageCostSessionQuery,
  display: UsageCostDisplayContext,
  now: Date,
): UsageCostSessionRow | null {
  if (!recordMatchesOrigin(session.origin, query.origin)) return null
  if (query.projectPath !== undefined) {
    const expected = query.projectPath ?? NO_PROJECT_KEY
    if (projectIdentityFor(session, display).key !== expected) return null
  }

  const rangeStartMs = rangeStartForPreset(query.preset, now)
  const rangeEndMs = now.getTime()
  const merged = newMutableBucket()
  let lastActivityMs: number | null = null
  let hasRecords = false

  for (const record of session.records) {
    if (!recordInWindow(record, rangeStartMs, rangeEndMs)) continue
    if (!recordMatchesDrillDown(record, query, now)) continue
    addRecord(merged, record)
    hasRecords = true
    lastActivityMs =
      lastActivityMs === null ? record.timestampMs : Math.max(lastActivityMs, record.timestampMs)
  }
  if (!hasRecords) return null

  return {
    sessionId: session.sessionId,
    title: session.title,
    file: session.file,
    projectLabel: projectIdentityFor(session, display).label,
    displayCwd: session.cwd === null ? null : displayPath(session.cwd, display.homePath),
    origin: session.origin,
    startedAtMs: session.startedAtMs,
    lastActivityMs: lastActivityMs ?? session.lastActivityMs,
    ...merged,
  }
}

function recordMatchesDrillDown(record: UsageCostRecord, query: UsageCostSessionQuery, now: Date) {
  if (query.provider !== undefined && record.provider !== query.provider) return false
  if (query.modelId !== undefined && record.modelId !== query.modelId) return false
  if (query.day !== undefined && localDayKey(record.timestampMs, now) !== query.day) return false
  return true
}
