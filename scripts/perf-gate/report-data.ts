/**
 * Reads the Performance Gate's JSON back from an artifact the pull request's run wrote. The
 * reporting workflow (perf-report.yml) runs main's code with write access to the pull request, so it
 * treats that artifact as untrusted: every field is checked here, ids must look like metric ids,
 * statuses must be known, and numbers must be finite. What fails is dropped, never rendered.
 */
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../support/object-fields'
import type { BudgetComparison, BudgetRow, BudgetRowStatus } from './budget-compare'
import {
  isTimingFailure,
  type MetricKind,
  type ThresholdChange,
  type TimingRow,
  type TimingStatus,
  type TimingVerdict,
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
const TIMING_STATUSES: readonly TimingStatus[] = [
  'regressed',
  'missing',
  'improved',
  'same',
  'unavailable',
]
const KINDS: readonly MetricKind[] = ['timing', 'memory', 'count', 'calls']
const UNITS = ['bytes', 'count'] as const
const SKIP_REASONS = ['no shipped code changed', 'not a pull request'] as const

/** Each field is checked where it is read, so a bad one drops only what it belongs to. */
const budgetRowFields = Schema.Struct({
  id: unknownField,
  status: unknownField,
  unit: unknownField,
  base: unknownField,
  head: unknownField,
  baseQuantum: unknownField,
  headQuantum: unknownField,
})
const comparisonFields = Schema.Struct({
  rows: unknownField,
  accepted: unknownField,
  loosened: unknownField,
  incomplete: unknownField,
})
const timingRowFields = Schema.Struct({
  id: unknownField,
  kind: unknownField,
  status: unknownField,
  base: unknownField,
  head: unknownField,
  delta: unknownField,
  relative: unknownField,
  limit: unknownField,
})
const thresholdChangeFields = Schema.Struct({
  name: unknownField,
  base: unknownField,
  head: unknownField,
})
const reportFields = Schema.Struct({
  baseSha: unknownField,
  headSha: unknownField,
  pullRequest: unknownField,
  platform: unknownField,
  timingsSkipped: unknownField,
  labels: unknownField,
  budgets: unknownField,
  timings: unknownField,
  pairs: unknownField,
})

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]) {
  return allowed.find((candidate) => candidate === value) ?? null
}

function list(value: unknown) {
  const result: readonly unknown[] = Array.isArray(value) ? value.slice(0, MAX_ROWS) : []
  return result
}

function budgetRow(value: unknown) {
  const fields = objectFields(budgetRowFields, value)
  const id = fields?.id
  const status = oneOf(fields?.status, BUDGET_STATUSES)
  if (fields === undefined || typeof id !== 'string' || !METRIC_ID.test(id) || status === null) {
    return []
  }
  const row: BudgetRow = {
    id,
    title: id,
    unit: oneOf(fields.unit, UNITS) ?? 'count',
    base: finite(fields.base),
    head: finite(fields.head),
    baseQuantum: finite(fields.baseQuantum),
    headQuantum: finite(fields.headQuantum),
    status,
    fix: '',
  }
  return [row]
}

function budgets(value: unknown) {
  const fields = objectFields(comparisonFields, value)
  if (fields === undefined) return null
  const rows = list(fields.rows).flatMap(budgetRow)
  const increases = rows.filter((row) =>
    ['raised', 'removed', 'quantum-raised'].includes(row.status),
  )
  const accepted = fields.accepted === true
  const comparison: BudgetComparison = {
    rows,
    increases,
    accepted,
    passed: increases.length === 0 || accepted,
  }
  return comparison
}

function timingRow(value: unknown) {
  const fields = objectFields(timingRowFields, value)
  const id = fields?.id
  const kind = oneOf(fields?.kind, KINDS)
  const status = oneOf(fields?.status, TIMING_STATUSES)
  if (
    fields === undefined ||
    typeof id !== 'string' ||
    !METRIC_ID.test(id) ||
    kind === null ||
    status === null
  ) {
    return []
  }
  const row: TimingRow = {
    id,
    kind,
    base: finite(fields.base),
    head: finite(fields.head),
    delta: finite(fields.delta),
    relative: finite(fields.relative),
    limit: finite(fields.limit),
    status,
  }
  return [row]
}

function thresholdChange(value: unknown) {
  const fields = objectFields(thresholdChangeFields, value)
  const name = fields?.name
  const base = finite(fields?.base)
  const head = finite(fields?.head)
  if (typeof name !== 'string' || !METRIC_ID.test(name) || base === null || head === null) return []
  const change: ThresholdChange = { name, base, head }
  return [change]
}

function timings(value: unknown) {
  const fields = objectFields(comparisonFields, value)
  if (fields === undefined) return null
  const rows = list(fields.rows).flatMap(timingRow)
  const regressions = rows.filter(isTimingFailure)
  const loosened = list(fields.loosened).flatMap(thresholdChange)
  const incomplete = list(fields.incomplete).filter((line) => typeof line === 'string')
  const failing = regressions.length > 0 || loosened.length > 0
  const accepted = failing && fields.accepted === true
  const verdict: TimingVerdict = {
    rows,
    regressions,
    loosened,
    incomplete,
    accepted,
    passed: incomplete.length === 0 && (!failing || accepted),
  }
  return verdict
}

/** The report in `value`, or null when it is not one. */
export function parsePerfGateReport(value: unknown) {
  const fields = objectFields(reportFields, value)
  const baseSha = fields?.baseSha
  const headSha = fields?.headSha
  if (fields === undefined || typeof baseSha !== 'string' || typeof headSha !== 'string') {
    return null
  }
  if (!SHA.test(baseSha) || !SHA.test(headSha)) return null
  const pullRequest = finite(fields.pullRequest)
  const { platform } = fields
  const report: PerfGateReport = {
    baseSha,
    headSha,
    pullRequest: pullRequest !== null && Number.isSafeInteger(pullRequest) ? pullRequest : null,
    timingsSkipped: oneOf(fields.timingsSkipped, SKIP_REASONS),
    labels: list(fields.labels).filter(
      (label): label is string => typeof label === 'string' && LABEL.test(label),
    ),
    budgets: budgets(fields.budgets),
    timings: timings(fields.timings),
    pairs: finite(fields.pairs),
    platform: typeof platform === 'string' && PLATFORM.test(platform) ? platform : null,
  }
  return report
}
