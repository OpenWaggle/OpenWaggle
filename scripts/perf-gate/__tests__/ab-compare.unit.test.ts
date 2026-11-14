import { describe, expect, it } from 'vitest'
import type { AbResults } from '../ab-run'
import type { AbSample } from '../ab-sample'
import { compareTimings, loosenedThresholds, median, type Thresholds } from '../ab-compare'
import { abRegressionLines } from '../gate-files'

const MIB = 1_048_576
const THRESHOLDS: Thresholds = {
  pairs: 4,
  idleMs: 5_000,
  timing: { relative: 0.1, absolute: 60 },
  memory: { relative: 0.05, absolute: 12 * MIB },
  count: { relative: 0, absolute: 0 },
  calls: { relative: 0.1, absolute: 3 },
}

interface Shape {
  readonly chat?: number
  readonly ipc?: number
  readonly rss?: number
  readonly processes?: number
}

function sample(build: 'base' | 'head', order: number, shape: Shape = {}) {
  const jitter = (order % 2) * 7
  const chat = (shape.chat ?? 1_400) + jitter
  const launch = {
    windowReadyMs: 600 + jitter,
    backendReadyMs: 900 + jitter,
    chatReadyMs: chat,
    ipcCallsUntilChatReady: shape.ipc ?? 22,
    ipcChannelsUntilChatReady: null,
  }
  const memory = {
    rssBytes: shape.rss ?? 600 * MIB,
    processCount: shape.processes ?? 6,
    byRole: { main: 200 * MIB, renderer: 150 * MIB },
  }
  const result: AbSample = {
    build,
    order,
    cold: launch,
    warm: launch,
    idle: memory,
    afterTurn: memory,
    turnMs: 900,
  }
  return result
}

function results(head: Shape, pairs = 4) {
  const samples = Array.from({ length: pairs }, (_, index) => [
    sample('base', index + 1),
    sample('head', index + 1, head),
  ]).flat()
  const result: AbResults = {
    platform: 'linux',
    arch: 'x64',
    pairs,
    idleMs: 5_000,
    builds: { base: { label: 'base' }, head: { label: 'head' } },
    samples,
  }
  return result
}

function compare(head: Shape, headThresholds = THRESHOLDS) {
  return compareTimings({ results: results(head), thresholds: THRESHOLDS, headThresholds })
}

function compareResults(input: AbResults) {
  return compareTimings({ results: input, thresholds: THRESHOLDS, headThresholds: THRESHOLDS })
}

function regressed(head: Shape) {
  return compare(head).regressions.map((row) => row.id)
}

describe('the timing comparison', () => {
  it('takes the middle of an even count as the mean of the two middle values', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('finds nothing to highlight in a head measured against itself', () => {
    const outcome = compare({})
    expect(outcome).not.toHaveProperty('passed')
    expect(outcome.regressions).toEqual([])
    expect(outcome.incomplete).toEqual([])
    expect(outcome.rows.find((row) => row.id === 'cold.chat-ready')).toMatchObject({
      base: 1_403.5,
      head: 1_403.5,
      delta: 0,
      status: 'same',
    })
  })

  it('highlights a 300 ms slower chat with the medians and the samples, and names no label', () => {
    const fixture = results({ chat: 1_700 })
    const outcome = compareResults(fixture)
    expect(outcome.regressions.map((row) => row.id)).toEqual(['cold.chat-ready', 'warm.chat-ready'])
    expect(abRegressionLines(outcome, fixture)[0]).toBe(
      'cold.chat-ready: 1404 ms -> 1704 ms, paired median +300 ms (21.4%), over the 140 ms limit. ' +
        'Samples: base [1407, 1400, 1407, 1400], head [1707, 1700, 1707, 1700]. ' +
        'Reproduce with bun run perf:ab (.agents/memory/performance.md).',
    )
  })

  it('leaves a slowdown inside the noise limit unhighlighted', () => {
    expect(regressed({ chat: 1_450 })).toEqual([])
  })

  it('highlights any extra process, and IPC calls past their race floor', () => {
    expect(regressed({ ipc: 25 })).toEqual([])
    expect(regressed({ ipc: 26 })).toEqual(['cold.ipc-until-chat-ready'])
    expect(regressed({ processes: 7 })).toEqual(['idle.processes', 'after-turn.processes'])
  })

  it('highlights memory above both the relative and the absolute limit only', () => {
    expect(regressed({ rss: 620 * MIB })).toEqual([])
    expect(regressed({ rss: 660 * MIB })).toEqual(['idle.rss', 'after-turn.rss'])
  })

  it('highlights a metric the base measured and the head did not', () => {
    const unmeasured = results({})
    const samples = unmeasured.samples.map((entry) =>
      entry.build === 'head' ? { ...entry, cold: { ...entry.cold, chatReadyMs: null } } : entry,
    )
    const input = { ...unmeasured, samples }

    const outcome = compareResults(input)

    expect(outcome.regressions.map((row) => [row.id, row.status, row.head])).toEqual([
      ['cold.chat-ready', 'missing', null],
    ])
    expect(abRegressionLines(outcome, input)[0]).toContain(
      'cold.chat-ready: measured on the base (1404 ms) but not on the head.',
    )
  })

  it('leaves a count neither side measured unhighlighted', () => {
    const unmeasured = results({})
    const samples = unmeasured.samples.map((entry) => ({
      ...entry,
      cold: { ...entry.cold, ipcCallsUntilChatReady: null },
    }))

    const outcome = compareResults({ ...unmeasured, samples })

    expect(outcome.regressions).toEqual([])
    expect(outcome.rows.find((row) => row.id === 'cold.ipc-until-chat-ready')?.status).toBe(
      'unavailable',
    )
  })

  it('highlights a readiness timing neither side measured, and names it', () => {
    const unmeasured = results({})
    const input = {
      ...unmeasured,
      samples: unmeasured.samples.map((entry) => ({
        ...entry,
        warm: { ...entry.warm, chatReadyMs: null },
      })),
    }

    const outcome = compareResults(input)

    expect(outcome.regressions.map((row) => [row.id, row.status])).toEqual([
      ['warm.chat-ready', 'unavailable'],
    ])
    expect(abRegressionLines(outcome, input)[0]).toContain(
      'warm.chat-ready: measured on neither the base nor the head.',
    )
  })

  it.each([
    ['no samples', []],
    ['no base samples', results({}).samples.filter((entry) => entry.build === 'head')],
    ['fewer pairs than main asks for', results({}, 3).samples],
    [
      'samples whose orders do not pair',
      results({}).samples.map((entry) =>
        entry.build === 'head' ? { ...entry, order: entry.order + 10 } : entry,
      ),
    ],
  ])('says why results with %s cannot be judged', (_name, samples) => {
    const input: AbResults = { ...results({}), samples }

    const outcome = compareResults(input)

    expect(outcome.incomplete).toHaveLength(1)
    expect(abRegressionLines(outcome, input)[0]).toMatch(/the comparison needs 4\.$/)
  })

  it('names a loosened threshold and says main still judges the run', () => {
    const looser: Thresholds = { ...THRESHOLDS, timing: { relative: 0.2, absolute: 60 }, pairs: 2 }
    expect(loosenedThresholds(THRESHOLDS, looser)).toEqual([
      { name: 'timing.relative', base: 0.1, head: 0.2 },
      { name: 'pairs', base: 4, head: 2 },
    ])
    const outcome = compare({}, looser)
    expect(outcome.loosened).toHaveLength(2)
    expect(abRegressionLines(outcome, results({}))[0]).toBe(
      "performance/perf-gate/thresholds.json timing.relative loosened 0.1 -> 0.2; main's thresholds still judge this run.",
    )
  })
})
