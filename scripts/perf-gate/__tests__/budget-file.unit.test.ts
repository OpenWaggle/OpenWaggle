import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatPerfBudgetFile,
  parsePerfBudgetFile,
  PERF_BUDGET_FRAGMENTS_ENV,
  PERF_BUDGETS_FILE,
  perfBudgetFileFor,
  perfBudgetMismatches,
  perfBudgetShapeProblems,
  quantize,
  readPerfBudgetFile,
  recordPerfMeasurements,
} from '../budget-file'
import { PERF_BUDGET_METRICS } from '../budget-metrics'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-budget-file-'))
  roots.push(root)
  return root
}

describe('the budgets file', () => {
  it('rounds a measurement up to its quantum', () => {
    expect(quantize(1_000, 256)).toBe(1_024)
    expect(quantize(1_024, 256)).toBe(1_024)
    expect(quantize(7, 1)).toBe(7)
  })

  it('rejects values that are not integers and quanta that are not positive', () => {
    expect(() =>
      parsePerfBudgetFile('{"metrics":{"a":{"value":1.5,"quantum":1}}}', 'file'),
    ).toThrow('file: a is not { value, quantum } integers.')
    expect(() => parsePerfBudgetFile('{"metrics":{"a":{"value":1,"quantum":0}}}', 'file')).toThrow(
      'file: a is not { value, quantum } integers.',
    )
  })

  it('names what to run when the measurement moved up or down', () => {
    const measured = Object.fromEntries(PERF_BUDGET_METRICS.map((metric) => [metric.id, 0]))
    const file = perfBudgetFileFor(measured)
    const [metric] = PERF_BUDGET_METRICS
    if (metric === undefined) throw new Error('No metrics.')
    const up = perfBudgetMismatches(file, { [metric.id]: metric.quantum * 2 })
    expect(up.map((mismatch) => mismatch.message)).toEqual([
      expect.stringContaining(
        `${metric.id} went up: stored 0, measured ${String(metric.quantum * 2)}`,
      ),
    ])
    expect(up[0]?.message).toContain('perf-budget-increase label')
    const raised = perfBudgetFileFor({ ...measured, [metric.id]: metric.quantum * 2 })
    const down = perfBudgetMismatches(raised, { [metric.id]: 0 })
    expect(down[0]?.message).toContain('went down')
    expect(perfBudgetMismatches(file, { [metric.id]: 0 })).toEqual([])
  })

  it('reports keys the registry does not write, and missing ones', () => {
    const measured = Object.fromEntries(PERF_BUDGET_METRICS.map((metric) => [metric.id, 1]))
    const file = perfBudgetFileFor(measured)
    expect(perfBudgetShapeProblems(file)).toEqual([])
    const [first, ...rest] = Object.entries(file.metrics)
    const stale = {
      ...file,
      metrics: { ...Object.fromEntries(rest), 'gone.metric': { value: 1, quantum: 1 } },
    }
    expect(perfBudgetShapeProblems(stale)).toEqual([
      `${PERF_BUDGETS_FILE} has gone.metric, which no measurement writes.`,
      `${PERF_BUDGETS_FILE} lacks ${first?.[0] ?? ''}.`,
      'Run bun run perf:budgets:update and commit the file.',
    ])
  })

  it('hands values to an update run instead of comparing them', () => {
    const root = scratch()
    const fragments = path.join(root, 'fragments')
    const [metric] = PERF_BUDGET_METRICS
    if (metric === undefined) throw new Error('No metrics.')
    expect(
      recordPerfMeasurements(
        'group',
        { [metric.id]: 5 },
        { [PERF_BUDGET_FRAGMENTS_ENV]: fragments },
        root,
      ),
    ).toEqual([])
    expect(JSON.parse(fs.readFileSync(path.join(fragments, 'group.json'), 'utf8'))).toEqual({
      [metric.id]: 5,
    })
  })

  it('round-trips the committed file', () => {
    const committed = readPerfBudgetFile()
    expect(parsePerfBudgetFile(formatPerfBudgetFile(committed), 'round trip')).toEqual(committed)
    expect(perfBudgetShapeProblems(committed)).toEqual([])
  })
})
