/**
 * Compares a pull request's budgets file with main's. A value above main's, a removed metric or a
 * coarser quantum fails, unless the pull request carries the `perf-budget-increase` label; a lower
 * value passes (the file follows the measurement). Pure: the caller reads the files and the labels.
 */
import type { PerfBudgetFile } from './budget-file'
import type { PerfBudgetMetric } from './budget-metrics'

export const BUDGET_INCREASE_LABEL = 'perf-budget-increase'

export type BudgetRowStatus =
  | 'raised'
  | 'lowered'
  | 'same'
  | 'new'
  | 'removed'
  | 'quantum-raised'
  | 'quantum-lowered'

export interface BudgetRow {
  readonly id: string
  readonly title: string
  readonly unit: string
  readonly base: number | null
  readonly head: number | null
  readonly baseQuantum: number | null
  readonly headQuantum: number | null
  readonly status: BudgetRowStatus
  readonly fix: string
}

export interface BudgetComparison {
  readonly rows: readonly BudgetRow[]
  /** Rows that need the label: a raised value, a removed metric or a coarser quantum. */
  readonly increases: readonly BudgetRow[]
  readonly accepted: boolean
  readonly passed: boolean
}

const FAILING: ReadonlySet<BudgetRowStatus> = new Set(['raised', 'removed', 'quantum-raised'])

function rowStatus(
  base: PerfBudgetFile['metrics'][string] | undefined,
  head: PerfBudgetFile['metrics'][string] | undefined,
): BudgetRowStatus {
  if (base === undefined) return 'new'
  if (head === undefined) return 'removed'
  if (head.quantum > base.quantum) return 'quantum-raised'
  if (head.value > base.value) return 'raised'
  if (head.value < base.value) return 'lowered'
  return head.quantum < base.quantum ? 'quantum-lowered' : 'same'
}

export function compareBudgets(input: {
  readonly base: PerfBudgetFile
  readonly head: PerfBudgetFile
  readonly metrics: readonly PerfBudgetMetric[]
  readonly labels: readonly string[]
}): BudgetComparison {
  const described = new Map(input.metrics.map((metric) => [metric.id, metric]))
  const ids = [...new Set([...Object.keys(input.base.metrics), ...Object.keys(input.head.metrics)])]
  const rows = ids.map((id): BudgetRow => {
    const base = input.base.metrics[id]
    const head = input.head.metrics[id]
    const metric = described.get(id)
    return {
      id,
      title: metric?.title ?? id,
      unit: metric?.unit ?? 'count',
      base: base?.value ?? null,
      head: head?.value ?? null,
      baseQuantum: base?.quantum ?? null,
      headQuantum: head?.quantum ?? null,
      status: rowStatus(base, head),
      fix: metric?.fix ?? '',
    }
  })
  const increases = rows.filter((row) => FAILING.has(row.status))
  const accepted = increases.length > 0 && input.labels.includes(BUDGET_INCREASE_LABEL)
  return { rows, increases, accepted, passed: increases.length === 0 || accepted }
}

function change(row: BudgetRow) {
  if (row.status === 'removed') return `${row.id} was removed (${String(row.base)} on main)`
  if (row.status === 'quantum-raised') {
    return `${row.id} quantum ${String(row.baseQuantum)} -> ${String(row.headQuantum)} (a coarser limit)`
  }
  return `${row.id} ${String(row.base)} -> ${String(row.head)} ${row.unit}`
}

/** One line per increase, for the job log, with the fix hint and what accepting it takes. */
export function budgetFailureLines(comparison: BudgetComparison) {
  return comparison.increases.map(
    (row) =>
      `performance/perf-budgets.json: ${change(row)}. ${row.fix} ` +
      (comparison.accepted
        ? `Accepted by the ${BUDGET_INCREASE_LABEL} label.`
        : `Only a maintainer can accept it, with the ${BUDGET_INCREASE_LABEL} label.`),
  )
}
