/**
 * Reads the Performance Gate's JSON back from an artifact the pull request's run wrote. The
 * reporting workflow (perf-report.yml) runs main's code with write access to the pull request, so it
 * treats that artifact as untrusted: every field is checked here, ids must look like metric ids,
 * statuses must be known, and numbers must be finite. What fails is dropped, never rendered.
 */
import type { BudgetComparison, BudgetRow, BudgetRowStatus } from './budget-compare'
import type {
  MetricKind,
  ThresholdChange,
  TimingRow,
  TimingStatus,
  TimingVerdict,
} from './ab-verdict'

export interface PerfGateReport {
  readonly baseSha: string
  readonly headSha: string
  readonly pullRequest: number | null
  /** Why timings did not run, when they did not. */
  readonly timingsSkipped: string | null
  readonly labels: readonly string[]
  readonly budgets: BudgetComparison | null
  readonly timings: TimingVerdict | null
  readonly pairs: number | null
  readonly platform: string | null
}

const SHA = /^[0-9a-f]{40}$/u
const METRIC_ID = /^[a-z][a-z0-9.-]{0,79}$/u
const LABEL = /^[a-z0-9][a-z0-9-]{0,49}$/u
const PLATFORM = /^[a-z0-9-]{1,32}$/u
const MAX_ROWS = 500
const BUDGET_STATUSES: readonly BudgetRowStatus[] = [
  'raised',
  'lowered',
  'same',
  'new',
  'removed',
  'quantum-raised',
  'quantum-lowered',
]
const TIMING_STATUSES: readonly TimingStatus[] = ['regressed', 'improved', 'same', 'unavailable']
const KINDS: readonly MetricKind[] = ['timing', 'memory', 'count']
const UNITS = ['bytes', 'count'] as const
const SKIP_REASONS = ['no shipped code changed', 'not a pull request'] as const

type Fields = Readonly<Record<string, unknown>>

function record(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_ROWS) : []
}

function budgetRow(value: unknown): BudgetRow[] {
  const fields = record(value)
  const id = fields?.['id']
  const status = oneOf(fields?.['status'], BUDGET_STATUSES)
  if (fields === null || typeof id !== 'string' || !METRIC_ID.test(id) || status === null) return []
  return [
    {
      id,
      title: id,
      unit: oneOf(fields['unit'], UNITS) ?? 'count',
      base: finite(fields['base']),
      head: finite(fields['head']),
      baseQuantum: finite(fields['baseQuantum']),
      headQuantum: finite(fields['headQuantum']),
      status,
      fix: '',
    },
  ]
}

function budgets(value: unknown): BudgetComparison | null {
  const fields = record(value)
  if (fields === null) return null
  const rows = list(fields['rows']).flatMap(budgetRow)
  const increases = rows.filter((row) =>
    ['raised', 'removed', 'quantum-raised'].includes(row.status),
  )
  const accepted = fields['accepted'] === true
  return { rows, increases, accepted, passed: increases.length === 0 || accepted }
}

function timingRow(value: unknown): TimingRow[] {
  const fields = record(value)
  const id = fields?.['id']
  const kind = oneOf(fields?.['kind'], KINDS)
  const status = oneOf(fields?.['status'], TIMING_STATUSES)
  if (
    fields === null ||
    typeof id !== 'string' ||
    !METRIC_ID.test(id) ||
    kind === null ||
    status === null
  ) {
    return []
  }
  return [
    {
      id,
      kind,
      base: finite(fields['base']),
      head: finite(fields['head']),
      delta: finite(fields['delta']),
      relative: finite(fields['relative']),
      limit: finite(fields['limit']),
      status,
    },
  ]
}

function thresholdChange(value: unknown): ThresholdChange[] {
  const fields = record(value)
  const name = fields?.['name']
  const base = finite(fields?.['base'])
  const head = finite(fields?.['head'])
  if (typeof name !== 'string' || !METRIC_ID.test(name) || base === null || head === null) return []
  return [{ name, base, head }]
}

function timings(value: unknown): TimingVerdict | null {
  const fields = record(value)
  if (fields === null) return null
  const rows = list(fields['rows']).flatMap(timingRow)
  const regressions = rows.filter((row) => row.status === 'regressed')
  const loosened = list(fields['loosened']).flatMap(thresholdChange)
  const failing = regressions.length > 0 || loosened.length > 0
  const accepted = failing && fields['accepted'] === true
  return { rows, regressions, loosened, accepted, passed: !failing || accepted }
}

/** The report in `value`, or null when it is not one. */
export function parsePerfGateReport(value: unknown): PerfGateReport | null {
  const fields = record(value)
  const baseSha = fields?.['baseSha']
  const headSha = fields?.['headSha']
  if (fields === null || typeof baseSha !== 'string' || typeof headSha !== 'string') return null
  if (!SHA.test(baseSha) || !SHA.test(headSha)) return null
  const pullRequest = finite(fields['pullRequest'])
  const platform = fields['platform']
  return {
    baseSha,
    headSha,
    pullRequest: pullRequest !== null && Number.isSafeInteger(pullRequest) ? pullRequest : null,
    timingsSkipped: oneOf(fields['timingsSkipped'], SKIP_REASONS),
    labels: list(fields['labels']).filter(
      (label): label is string => typeof label === 'string' && LABEL.test(label),
    ),
    budgets: budgets(fields['budgets']),
    timings: timings(fields['timings']),
    pairs: finite(fields['pairs']),
    platform: typeof platform === 'string' && PLATFORM.test(platform) ? platform : null,
  }
}
