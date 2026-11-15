/**
 * For an integration test that measures performance budget metrics: compares its raw values with
 * performance/perf-budgets.json, or, during `bun run perf:budgets:update`, hands them to the update.
 * Every id must be in budget-metrics.ts with this test file as its `source`.
 */
import { expect } from 'vitest'
import { metricById, recordPerfMeasurements } from './budget-file'

export function expectPerfMeasurements(
  group: string,
  source: string,
  measured: Readonly<Record<string, number>>,
) {
  const foreign = Object.keys(measured).filter((id) => metricById(id).source !== source)
  expect(foreign, `metrics whose source in budget-metrics.ts is not ${source}`).toEqual([])
  const mismatches = recordPerfMeasurements(group, measured).map((mismatch) => mismatch.message)
  expect(mismatches, 'performance/perf-budgets.json differs from the measurement').toEqual([])
}
