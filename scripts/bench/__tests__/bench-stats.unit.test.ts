import { describe, expect, it } from 'vitest'
import type { AppMemory } from '../app-processes'
import { type BenchResult, isBenchResult, median, summarizeBench, tableRow } from '../bench-stats'

function memory(rssBytes: number, gpu: number) {
  const memory: AppMemory = {
    rssBytes,
    processCount: 2,
    byRole: { main: { count: 1, rssBytes: rssBytes - gpu }, gpu: { count: 1, rssBytes: gpu } },
    processes: [],
  }
  return memory
}

function run(windowReadyMs: number, rss: number) {
  const sample = {
    windowReadyMs,
    backendReadyMs: windowReadyMs + 100,
    marks: { ready: windowReadyMs },
  }
  return {
    cold: { ...sample, idle: memory(rss, 10), afterTurn: memory(rss + 1, 10), runMs: 5 },
    warm: { ...sample, idle: memory(rss, 10) },
  }
}

const result: BenchResult = {
  label: 'baseline',
  platform: 'darwin',
  arch: 'arm64',
  downloads: { 'openwaggle-1-arm64.dmg': 200_000_000 },
  installedBytes: 600_000_000,
  runs: [run(400, 1_048_576_00), run(100, 1_048_576_00), run(300, 2_097_152_00), run(200, 0)],
  proof: null,
}

describe('bench medians', () => {
  it.each([
    [[], null],
    [[3], 3],
    [[4, 1, 3, 2], 2.5],
    [[5, Number.NaN, 1, 3], 3],
  ])('median of %j is %j', (values, expected) => {
    expect(median(values)).toBe(expected)
  })

  it('summarizes each column and process role across runs', () => {
    expect(summarizeBench(result)).toMatchObject({
      coldWindowReadyMs: 250,
      coldBackendReadyMs: 350,
      idleByRole: { gpu: 10 },
      coldMarks: { ready: 250 },
    })
  })

  it('renders the row the Electrobun table uses', () => {
    expect(tableRow(summarizeBench(result))).toBe(
      '| baseline | 200.0 MB (dmg) | 600.0 MB | 250 ms / 350 ms | 250 ms / 350 ms | 100 MiB (2 processes) | 100 MiB |',
    )
  })

  it.each([
    [result, true],
    [{ ...result, runs: [{ cold: {} }] }, false],
    [{ ...result, label: 1 }, false],
    [null, false],
  ])('recognizes a result file (%#)', (value, expected) => {
    expect(isBenchResult(value)).toBe(expected)
  })
})
