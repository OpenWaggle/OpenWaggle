/** Reading the A/B run's files, and the evidence lines the verdict prints when it fails. */
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../support/object-fields'
import type { AbResults } from './ab-run'
import type { AbSample } from './ab-sample'
import {
  abMetrics,
  type Limit,
  REGRESSION_ACCEPTED_LABEL,
  type Thresholds,
  type TimingRow,
  type TimingVerdict,
} from './ab-verdict'

const PERCENT = 100
const MEBIBYTE = 1_048_576
const DECIMALS = 1

const limitFields = Schema.Struct({ relative: unknownField, absolute: unknownField })
const thresholdFields = Schema.Struct({
  pairs: unknownField,
  idleMs: unknownField,
  timing: unknownField,
  memory: unknownField,
  count: unknownField,
  calls: unknownField,
})
const resultFields = Schema.Struct({
  samples: unknownField,
  builds: unknownField,
  platform: unknownField,
  arch: unknownField,
  pairs: unknownField,
  idleMs: unknownField,
})

function fields<A, I>(schema: Schema.Schema<A, I>, value: unknown, what: string) {
  const parsed = objectFields(schema, value)
  if (parsed === undefined) throw new Error(`${what} is not an object.`)
  return parsed
}

function limit(value: unknown, what: string) {
  const { relative, absolute } = fields(limitFields, value, what)
  if (
    typeof relative !== 'number' ||
    typeof absolute !== 'number' ||
    relative < 0 ||
    absolute < 0
  ) {
    throw new Error(`${what} needs non-negative relative and absolute numbers.`)
  }
  const result: Limit = { relative, absolute }
  return result
}

export function parseThresholds(value: unknown) {
  const parsed = fields(thresholdFields, value, 'The thresholds file')
  const { pairs, idleMs } = parsed
  if (typeof pairs !== 'number' || !Number.isSafeInteger(pairs) || pairs < 1) {
    throw new Error('The thresholds file needs a positive integer pairs.')
  }
  if (typeof idleMs !== 'number' || idleMs < 0) throw new Error('The thresholds file needs idleMs.')
  const thresholds: Thresholds = {
    pairs,
    idleMs,
    timing: limit(parsed.timing, 'timing'),
    memory: limit(parsed.memory, 'memory'),
    count: limit(parsed.count, 'count'),
    calls: limit(parsed.calls, 'calls'),
  }
  return thresholds
}

function isSample(value: unknown): value is AbSample {
  if (typeof value !== 'object' || value === null) return false
  return ['build', 'order', 'cold', 'warm', 'idle', 'afterTurn'].every((key) => key in value)
}

/** The A/B run's own output; trusted, since this job wrote it. */
export function parseAbResults(value: unknown) {
  const parsed = fields(resultFields, value, 'The A/B results')
  const { samples, builds } = parsed
  if (
    !Array.isArray(samples) ||
    !samples.every(isSample) ||
    typeof builds !== 'object' ||
    builds === null
  ) {
    throw new Error('The A/B results have no samples.')
  }
  const results: AbResults = {
    platform: String(parsed.platform),
    arch: String(parsed.arch),
    pairs: Number(parsed.pairs),
    idleMs: Number(parsed.idleMs),
    builds: { base: { label: 'base' }, head: { label: 'head' } },
    samples,
  }
  return results
}

function value(row: TimingRow, amount: number | null) {
  if (amount === null) return '–'
  if (row.kind === 'memory') return `${(amount / MEBIBYTE).toFixed(DECIMALS)} MiB`
  return row.kind === 'timing' ? `${String(Math.round(amount))} ms` : String(amount)
}

function samplesOf(results: AbResults, id: string) {
  const metric = abMetrics(results.samples).find(([candidate]) => candidate === id)
  if (metric === undefined) return ''
  const [, , reader] = metric
  const list = (build: string) =>
    results.samples
      .filter((sample) => sample.build === build)
      .map((sample) => String(reader(sample) ?? '–'))
      .join(', ')
  return ` Samples: base [${list('base')}], head [${list('head')}].`
}

/** One line per regression and loosened threshold, with the samples behind it. */
export function abFailureLines(verdict: TimingVerdict, results: AbResults) {
  const outcome = verdict.accepted
    ? `Accepted by the ${REGRESSION_ACCEPTED_LABEL} label.`
    : `Only a maintainer can accept it, with the ${REGRESSION_ACCEPTED_LABEL} label.`
  return [
    ...verdict.regressions.map((row) => {
      const relative =
        row.relative === null ? '' : ` (${(row.relative * PERCENT).toFixed(DECIMALS)}%)`
      return (
        `${row.id}: ${value(row, row.base)} -> ${value(row, row.head)}, paired median +${value(row, row.delta)}${relative}, ` +
        `over the ${value(row, row.limit)} limit.${samplesOf(results, row.id)} Reproduce with bun run perf:ab (.agents/memory/performance.md). ${outcome}`
      )
    }),
    ...verdict.loosened.map(
      (change) =>
        `performance/perf-gate/thresholds.json ${change.name} loosened ${String(change.base)} -> ${String(change.head)}. ${outcome}`,
    ),
  ]
}
