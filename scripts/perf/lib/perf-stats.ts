/** Order statistics for repeated measurements. Every gate reports medians. */
export interface Summary {
  readonly count: number
  readonly median: number | null
  readonly p90: number | null
  readonly min: number | null
  readonly max: number | null
}

const MEDIAN_QUANTILE = 0.5
const P90_QUANTILE = 0.9
const TENTHS_PER_UNIT = 10

export function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const lowerValue = sorted[lower] ?? 0
  const upperValue = sorted[upper] ?? lowerValue
  return lowerValue + (upperValue - lowerValue) * (position - lower)
}

export function median(values: readonly number[]) {
  return quantile(values, MEDIAN_QUANTILE)
}

export function summarize(values: readonly (number | null | undefined)[]): Summary {
  const present = values.filter((value): value is number => typeof value === 'number')
  return {
    count: present.length,
    median: median(present),
    p90: quantile(present, P90_QUANTILE),
    min: present.length > 0 ? Math.min(...present) : null,
    max: present.length > 0 ? Math.max(...present) : null,
  }
}

/** Summaries of the named numeric fields across runs; failed runs and missing fields are skipped. */
export function summarizeRuns(runs: readonly object[], keys: readonly string[]) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      summarize(
        runs.map((run) => {
          const value: unknown = Reflect.get(run, key)
          return typeof value === 'number' ? value : null
        }),
      ),
    ]),
  )
}

/** Rounds to a tenth, which is finer than any timing here can resolve. */
export function roundTenth(value: number) {
  return Math.round(value * TENTHS_PER_UNIT) / TENTHS_PER_UNIT
}
