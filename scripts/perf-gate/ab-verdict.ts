/**
 * The Performance Gate's verdict on an A/B run (ab-run.ts): for every timing, memory reading and
 * count, the medians of the base and head samples and the median of their paired differences
 * (pair i is the base and head sample measured one after the other, so slow drift of the runner
 * cancels). The head regressed on a metric when that median difference exceeds both the relative
 * limit (of the base median) and the absolute limit of its kind (performance/perf-gate/thresholds.json).
 * A pull request that regresses, or loosens a threshold, fails unless it carries the
 * `perf-regression-accepted` label. Pure: the caller reads the files and the labels.
 */
import type { AbResults } from './ab-run'
import type { AbSample, MemorySample } from './ab-sample'

export const REGRESSION_ACCEPTED_LABEL = 'perf-regression-accepted'

/** `calls` is a count that races its milestone (IPC before chat ready), so it has a floor. */
export type MetricKind = 'timing' | 'memory' | 'count' | 'calls'

export interface Limit {
  readonly relative: number
  readonly absolute: number
}

export interface Thresholds {
  readonly pairs: number
  readonly idleMs: number
  readonly timing: Limit
  readonly memory: Limit
  readonly count: Limit
  readonly calls: Limit
}

/**
 * `missing`: measured on the base but not the head, which fails like a regression (a head that
 * stops reporting a metric must not pass unjudged). `unavailable`: the base has no value either,
 * which fails too for a readiness timing measured on neither side (every launch reports them).
 */
export type TimingStatus = 'regressed' | 'missing' | 'improved' | 'same' | 'unavailable'

export interface TimingRow {
  readonly id: string
  readonly kind: MetricKind
  readonly base: number | null
  readonly head: number | null
  /** Median of the paired differences, head minus base. */
  readonly delta: number | null
  readonly relative: number | null
  readonly limit: number | null
  readonly status: TimingStatus
}

export interface ThresholdChange {
  readonly name: string
  readonly base: number
  readonly head: number
}

export interface TimingVerdict {
  readonly rows: readonly TimingRow[]
  readonly regressions: readonly TimingRow[]
  readonly loosened: readonly ThresholdChange[]
  /**
   * Why the samples cannot be judged: fewer base and head samples paired by order than main's
   * `pairs`. No label accepts it, since there is nothing to accept.
   */
  readonly incomplete: readonly string[]
  readonly accepted: boolean
  readonly passed: boolean
}

const PAIR = 2
const KINDS: readonly MetricKind[] = ['timing', 'memory', 'count', 'calls']

export function median(values: readonly number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const lower = sorted[Math.floor((sorted.length - 1) / PAIR)] ?? 0
  const upper = sorted[Math.ceil((sorted.length - 1) / PAIR)] ?? lower
  return (lower + upper) / PAIR
}

type Reader = (sample: AbSample) => number | null | undefined

const PHASE_IDS = { idle: 'idle', afterTurn: 'after-turn' } as const

function memoryReaders(samples: readonly AbSample[], phase: 'idle' | 'afterTurn') {
  const roles = [...new Set(samples.flatMap((sample) => Object.keys(sample[phase].byRole)))].sort()
  const id = PHASE_IDS[phase]
  const readers: [string, MetricKind, Reader][] = [
    [`${id}.rss`, 'memory', (sample) => sample[phase].rssBytes],
    [`${id}.processes`, 'count', (sample) => sample[phase].processCount],
  ]
  for (const role of roles) {
    const read = (memory: MemorySample) => memory.byRole[role] ?? 0
    readers.push([`${id}.rss.${role}`, 'memory', (sample) => read(sample[phase])])
  }
  return readers
}

/** Every metric of an A/B run, as an id, its kind and how to read it from a sample. */
export function abMetrics(samples: readonly AbSample[]) {
  const launches: [string, MetricKind, Reader][] = (['cold', 'warm'] as const).flatMap((launch) => [
    [`${launch}.window-ready`, 'timing', (sample: AbSample) => sample[launch].windowReadyMs],
    [`${launch}.backend-ready`, 'timing', (sample: AbSample) => sample[launch].backendReadyMs],
    [`${launch}.chat-ready`, 'timing', (sample: AbSample) => sample[launch].chatReadyMs],
  ])
  // Only the cold count is judged. A warm launch's count is bimodal (17 or 25-33 on the gate's
  // runner) by whether git, skills and project-config calls land before chat ready, so it stays in
  // the artifact (ipcCallsUntilChatReady) and out of the verdict.
  launches.push([
    'cold.ipc-until-chat-ready',
    'calls',
    (sample: AbSample) => sample.cold.ipcCallsUntilChatReady,
  ])
  return [...launches, ...memoryReaders(samples, 'idle'), ...memoryReaders(samples, 'afterTurn')]
}

function numbers(values: readonly (number | null | undefined)[]) {
  return values.filter((value): value is number => typeof value === 'number')
}

function row(id: string, kind: MetricKind, read: Reader, results: AbResults, limit: Limit) {
  const base = results.samples.filter((sample) => sample.build === 'base')
  const head = results.samples.filter((sample) => sample.build === 'head')
  const differences = numbers(
    base.map((sample) => {
      const pair = head.find((candidate) => candidate.order === sample.order)
      const before = read(sample)
      const after = pair === undefined ? null : read(pair)
      return typeof before === 'number' && typeof after === 'number' ? after - before : null
    }),
  )
  const baseMedian = median(numbers(base.map(read)))
  const headMedian = median(numbers(head.map(read)))
  const delta = median(differences)
  if (baseMedian === null || headMedian === null || delta === null) {
    const unjudged: TimingRow = {
      id,
      kind,
      base: baseMedian,
      head: headMedian,
      delta,
      relative: null,
      limit: null,
      status: baseMedian === null ? 'unavailable' : 'missing',
    }
    return unjudged
  }
  const allowed = Math.max(limit.relative * baseMedian, limit.absolute)
  const relative = baseMedian === 0 ? null : delta / baseMedian
  const status: TimingStatus =
    delta > allowed ? 'regressed' : delta < -allowed ? 'improved' : 'same'
  const measured: TimingRow = {
    id,
    kind,
    base: baseMedian,
    head: headMedian,
    delta,
    relative,
    limit: allowed,
    status,
  }
  return measured
}

/** A readiness timing measured on neither side: the launches did not report it at all. */
export function isUnmeasuredReadiness(candidate: TimingRow) {
  return (
    candidate.kind === 'timing' && candidate.status === 'unavailable' && candidate.head === null
  )
}

/** A row that fails the gate unless a maintainer accepts it. */
export function isTimingFailure(candidate: TimingRow) {
  return (
    candidate.status === 'regressed' ||
    candidate.status === 'missing' ||
    isUnmeasuredReadiness(candidate)
  )
}

/** The problem with too few samples to judge: under `pairs` base and head samples sharing an order. */
export function incompleteSamples(samples: readonly AbSample[], pairs: number) {
  const orders = (build: AbSample['build']) =>
    new Set(samples.filter((sample) => sample.build === build).map((sample) => sample.order))
  const base = orders('base')
  const head = orders('head')
  const paired = [...base].filter((order) => head.has(order)).length
  if (paired >= pairs) return []
  return [
    `The A/B results hold ${String(paired)} base and head sample pairs (base ${String(base.size)}, head ${String(head.size)}); the gate needs ${String(pairs)}.`,
  ]
}

/** Limits the head's thresholds file loosens against main's: a higher limit or fewer pairs. */
export function loosenedThresholds(base: Thresholds, head: Thresholds) {
  const changes: ThresholdChange[] = []
  for (const kind of KINDS) {
    for (const part of ['relative', 'absolute'] as const) {
      if (head[kind][part] > base[kind][part]) {
        changes.push({ name: `${kind}.${part}`, base: base[kind][part], head: head[kind][part] })
      }
    }
  }
  if (head.pairs < base.pairs) changes.push({ name: 'pairs', base: base.pairs, head: head.pairs })
  return changes
}

export function timingVerdict(input: {
  readonly results: AbResults
  readonly thresholds: Thresholds
  readonly headThresholds: Thresholds
  readonly labels: readonly string[]
}) {
  const rows = abMetrics(input.results.samples).map(([id, kind, read]) =>
    row(id, kind, read, input.results, input.thresholds[kind]),
  )
  const regressions = rows.filter(isTimingFailure)
  const loosened = loosenedThresholds(input.thresholds, input.headThresholds)
  const incomplete = incompleteSamples(input.results.samples, input.thresholds.pairs)
  const failing = regressions.length > 0 || loosened.length > 0
  const accepted = failing && input.labels.includes(REGRESSION_ACCEPTED_LABEL)
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
