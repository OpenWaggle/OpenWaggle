import { describe, expect, it } from 'vitest'
import { BUDGET_INCREASE_LABEL, budgetFailureLines, compareBudgets } from '../budget-compare'
import type { PerfBudgetFile } from '../budget-file'
import type { PerfBudgetMetric } from '../budget-metrics'

const METRICS: readonly PerfBudgetMetric[] = [
  {
    id: 'ipc.calls',
    title: 'IPC calls',
    unit: 'count',
    quantum: 1,
    source: 'build',
    fix: 'Batch the calls.',
  },
  {
    id: 'bundle.bytes',
    title: 'Bundle bytes',
    unit: 'bytes',
    quantum: 1024,
    source: 'build',
    fix: 'Load it on use.',
  },
]

function file(metrics: Record<string, [number, number]>) {
  const result: PerfBudgetFile = {
    about: '',
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([id, [value, quantum]]) => [id, { value, quantum }]),
    ),
  }
  return result
}

const main = file({ 'ipc.calls': [22, 1], 'bundle.bytes': [10_240, 1024] })

describe('compareBudgets', () => {
  it('passes a pull request whose values are main values or lower', () => {
    const comparison = compareBudgets({
      base: main,
      head: file({ 'ipc.calls': [21, 1], 'bundle.bytes': [10_240, 1024] }),
      metrics: METRICS,
      labels: [],
    })
    expect(comparison.passed).toBe(true)
    expect(comparison.rows.map((row) => row.status)).toEqual(['lowered', 'same'])
    expect(budgetFailureLines(comparison)).toEqual([])
  })

  it('fails a raised value with the metric, old -> new and the fix, unless the label accepts it', () => {
    const head = file({ 'ipc.calls': [23, 1], 'bundle.bytes': [10_240, 1024] })
    const refused = compareBudgets({ base: main, head, metrics: METRICS, labels: ['other'] })
    expect(refused.passed).toBe(false)
    expect(budgetFailureLines(refused)).toEqual([
      `performance/perf-budgets.json: ipc.calls 22 -> 23 count. Batch the calls. Only a maintainer can accept it, with the ${BUDGET_INCREASE_LABEL} label.`,
    ])
    const accepted = compareBudgets({
      base: main,
      head,
      metrics: METRICS,
      labels: [BUDGET_INCREASE_LABEL],
    })
    expect(accepted).toMatchObject({ passed: true, accepted: true })
  })

  it('treats a removed metric and a coarser quantum as raised limits', () => {
    const comparison = compareBudgets({
      base: main,
      head: file({ 'bundle.bytes': [12_288, 4096] }),
      metrics: METRICS,
      labels: [],
    })
    expect(comparison.increases.map((row) => [row.id, row.status])).toEqual([
      ['ipc.calls', 'removed'],
      ['bundle.bytes', 'quantum-raised'],
    ])
    expect(comparison.passed).toBe(false)
  })

  it('passes a new metric that main does not have yet', () => {
    const comparison = compareBudgets({
      base: file({}),
      head: main,
      metrics: METRICS,
      labels: [],
    })
    expect(comparison.rows.map((row) => row.status)).toEqual(['new', 'new'])
    expect(comparison.passed).toBe(true)
  })
})
