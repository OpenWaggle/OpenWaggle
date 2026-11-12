/**
 * Medians and the results table of the shell bench (scripts/bench/electron-bench.ts). Shell-neutral:
 * it reads only the result shape, so an Electrobun run that writes the same fields renders the same
 * columns: download, installed, cold and warm window-ready, backend-ready, idle and after-turn RSS.
 */
import type { AppMemory } from './app-processes'

export interface LaunchSample {
  /** Spawn until the DevTools endpoint lists the renderer page. */
  readonly windowReadyMs: number
  /** Spawn until the window reports startup status `ready` (the Session Host answered). */
  readonly backendReadyMs: number
  /** Startup timing marks the main process logged, by label, in ms after spawn. */
  readonly marks: Readonly<Record<string, number>>
  readonly idle: AppMemory
}

export interface BenchRun {
  readonly cold: LaunchSample & { readonly afterTurn: AppMemory; readonly runMs: number }
  readonly warm: LaunchSample
}

export interface BenchResult {
  readonly label: string
  readonly platform: string
  readonly arch: string
  readonly downloads: Readonly<Record<string, number>>
  readonly installedBytes: number
  readonly runs: readonly BenchRun[]
  readonly proof: unknown
}

/** Halves: the middle index, and the mean of the two middle values of an even count. */
const PAIR = 2
const BYTES_PER_MB = 1_000_000
const BYTES_PER_MIB = 1_048_576

/** A result file of `electron-bench.ts measure`; the run fields are what the summary reads. */
export function isBenchResult(value: unknown): value is BenchResult {
  if (typeof value !== 'object' || value === null) return false
  const fields = new Map<string, unknown>(Object.entries(value))
  const runs = fields.get('runs')
  return (
    typeof fields.get('label') === 'string' &&
    typeof fields.get('platform') === 'string' &&
    typeof fields.get('installedBytes') === 'number' &&
    typeof fields.get('downloads') === 'object' &&
    Array.isArray(runs) &&
    runs.every(
      (run: unknown) => typeof run === 'object' && run !== null && 'cold' in run && 'warm' in run,
    )
  )
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = (sorted.length - 1) / PAIR
  const lower = sorted[Math.floor(middle)] ?? 0
  const upper = sorted[Math.ceil(middle)] ?? lower
  return (lower + upper) / PAIR
}

function medianOf(runs: readonly BenchRun[], read: (run: BenchRun) => number | undefined) {
  return median(
    runs.flatMap((run) => {
      const value = read(run)
      return value === undefined ? [] : [value]
    }),
  )
}

function roleMedians(runs: readonly BenchRun[], read: (run: BenchRun) => AppMemory) {
  const roles = [...new Set(runs.flatMap((run) => Object.keys(read(run).byRole)))].sort()
  const byRole: Record<string, number | null> = {}
  for (const role of roles) {
    byRole[role] = median(
      runs.map((run) => {
        const totals = new Map(Object.entries(read(run).byRole))
        return totals.get(role)?.rssBytes ?? 0
      }),
    )
  }
  return byRole
}

export function summarizeBench(result: BenchResult) {
  const { runs } = result
  return {
    label: result.label,
    platform: `${result.platform}-${result.arch}`,
    runs: runs.length,
    downloads: result.downloads,
    installedBytes: result.installedBytes,
    coldWindowReadyMs: medianOf(runs, (run) => run.cold.windowReadyMs),
    coldBackendReadyMs: medianOf(runs, (run) => run.cold.backendReadyMs),
    warmWindowReadyMs: medianOf(runs, (run) => run.warm.windowReadyMs),
    warmBackendReadyMs: medianOf(runs, (run) => run.warm.backendReadyMs),
    idleRssBytes: medianOf(runs, (run) => run.cold.idle.rssBytes),
    idleProcesses: medianOf(runs, (run) => run.cold.idle.processCount),
    afterTurnRssBytes: medianOf(runs, (run) => run.cold.afterTurn.rssBytes),
    warmIdleRssBytes: medianOf(runs, (run) => run.warm.idle.rssBytes),
    runMs: medianOf(runs, (run) => run.cold.runMs),
    idleByRole: roleMedians(runs, (run) => run.cold.idle),
    afterTurnByRole: roleMedians(runs, (run) => run.cold.afterTurn),
    coldMarks: markMedians(runs, (run) => run.cold.marks),
    warmMarks: markMedians(runs, (run) => run.warm.marks),
  }
}

function markMedians(
  runs: readonly BenchRun[],
  read: (run: BenchRun) => Readonly<Record<string, number>>,
) {
  const labels = new Set(runs.flatMap((run) => Object.keys(read(run))))
  return Object.fromEntries(
    [...labels].sort().map((label) => [label, medianOf(runs, (run) => read(run)[label])]),
  )
}

export type BenchSummary = ReturnType<typeof summarizeBench>

function megabytes(bytes: number | null | undefined) {
  return typeof bytes === 'number' ? `${(bytes / BYTES_PER_MB).toFixed(1)} MB` : '–'
}

function mebibytes(bytes: number | null | undefined) {
  return typeof bytes === 'number' ? `${(bytes / BYTES_PER_MIB).toFixed(0)} MiB` : '–'
}

function milliseconds(value: number | null | undefined) {
  return typeof value === 'number' ? `${String(Math.round(value))} ms` : '–'
}

function downloads(summary: BenchSummary) {
  return Object.entries(summary.downloads)
    .map(([name, bytes]) => `${megabytes(bytes)} (${name.slice(name.lastIndexOf('.') + 1)})`)
    .join(', ')
}

export const TABLE_HEADER = [
  '| Build | Download | Installed | Cold window / backend | Warm window / backend | Idle RSS | After-turn RSS |',
  '| --- | --- | --- | --- | --- | --- | --- |',
] as const

export function tableRow(summary: BenchSummary) {
  return [
    `| ${summary.label}`,
    downloads(summary),
    megabytes(summary.installedBytes),
    `${milliseconds(summary.coldWindowReadyMs)} / ${milliseconds(summary.coldBackendReadyMs)}`,
    `${milliseconds(summary.warmWindowReadyMs)} / ${milliseconds(summary.warmBackendReadyMs)}`,
    `${mebibytes(summary.idleRssBytes)} (${String(summary.idleProcesses ?? '–')} processes)`,
    `${mebibytes(summary.afterTurnRssBytes)} |`,
  ].join(' | ')
}

export function roleTable(summary: BenchSummary) {
  const roles = [
    ...new Set([...Object.keys(summary.idleByRole), ...Object.keys(summary.afterTurnByRole)]),
  ].sort()
  return [
    '| Process | Idle RSS | After-turn RSS |',
    '| --- | --- | --- |',
    ...roles.map(
      (role) =>
        `| ${role} | ${mebibytes(summary.idleByRole[role])} | ${mebibytes(summary.afterTurnByRole[role])} |`,
    ),
  ]
}
