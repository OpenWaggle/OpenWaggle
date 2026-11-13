import { describe, expect, it } from 'vitest'
import { BUDGETS, PERF_GATE_FILES, ratchetFindings } from '../ratchets'

describe('Performance Gate files', () => {
  it('leaves the Performance Gate files to the gate, whose maintainer label can accept a raise', () => {
    expect(
      PERF_GATE_FILES.filter((file) => BUDGETS.some((budget) => budget.files.test(file))),
    ).toEqual([])
    const measured = (value: number) =>
      JSON.stringify({ metrics: { 'ipc.calls': { value, quantum: 1 } } })
    expect(ratchetFindings('performance/perf-budgets.json', measured(22), measured(23))).toEqual([])
    const thresholds = (relative: number) => JSON.stringify({ timing: { relative, absolute: 60 } })
    expect(
      ratchetFindings('performance/perf-gate/thresholds.json', thresholds(0.1), thresholds(0.2)),
    ).toEqual([])
  })
})
