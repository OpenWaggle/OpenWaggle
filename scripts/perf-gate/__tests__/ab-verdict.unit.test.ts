import { describe, expect, it } from 'vitest'
import type { AbResults } from '../ab-run'
import type { AbSample } from '../ab-sample'
import {
  loosenedThresholds,
  median,
  REGRESSION_ACCEPTED_LABEL,
  type Thresholds,
  timingVerdict,
} from '../ab-verdict'
import { abFailureLines } from '../gate-files'

const MIB = 1_048_576
const THRESHOLDS: Thresholds = {
  pairs: 4,
  idleMs: 5_000,
  timing: { relative: 0.1, absolute: 60 },
  memory: { relative: 0.05, absolute: 12 * MIB },
  count: { relative: 0, absolute: 0 },
  calls: { relative: 0.1, absolute: 4 },
}

interface Shape {
  readonly chat?: number
  readonly ipc?: number
  readonly rss?: number
  readonly processes?: number
}

function sample(build: 'base' | 'head', order: number, shape: Shape = {}): AbSample {
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
  return { build, order, cold: launch, warm: launch, idle: memory, afterTurn: memory, turnMs: 900 }
}

function results(head: Shape, pairs = 4): AbResults {
  const samples = Array.from({ length: pairs }, (_, index) => [
    sample('base', index + 1),
    sample('head', index + 1, head),
  ]).flat()
  return {
    platform: 'linux',
    arch: 'x64',
    pairs,
    idleMs: 5_000,
    builds: { base: { label: 'base' }, head: { label: 'head' } },
    samples,
  }
}

function verdict(head: Shape, labels: readonly string[] = [], headThresholds = THRESHOLDS) {
  return timingVerdict({ results: results(head), thresholds: THRESHOLDS, headThresholds, labels })
}

describe('the timing verdict', () => {
  it('takes the middle of an even count as the mean of the two middle values', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('passes a head measured against itself', () => {
    const outcome = verdict({})
    expect(outcome.passed).toBe(true)
    expect(outcome.regressions).toEqual([])
    expect(outcome.rows.find((row) => row.id === 'cold.chat-ready')).toMatchObject({
      base: 1_403.5,
      head: 1_403.5,
      delta: 0,
      status: 'same',
    })
  })

  it('fails a 300 ms slower chat with the medians, the samples and the label that accepts it', () => {
    const fixture = results({ chat: 1_700 })
    const outcome = timingVerdict({
      results: fixture,
      thresholds: THRESHOLDS,
      headThresholds: THRESHOLDS,
      labels: [],
    })
    expect(outcome.passed).toBe(false)
    expect(outcome.regressions.map((row) => row.id)).toEqual(['cold.chat-ready', 'warm.chat-ready'])
    expect(abFailureLines(outcome, fixture)[0]).toBe(
      'cold.chat-ready: 1404 ms -> 1704 ms, paired median +300 ms (21.4%), over the 140 ms limit. ' +
        'Samples: base [1407, 1400, 1407, 1400], head [1707, 1700, 1707, 1700]. ' +
        `Reproduce with bun run perf:ab (.agents/memory/performance.md). Only a maintainer can accept it, with the ${REGRESSION_ACCEPTED_LABEL} label.`,
    )
    expect(verdict({ chat: 1_700 }, [REGRESSION_ACCEPTED_LABEL])).toMatchObject({
      passed: true,
      accepted: true,
    })
  })

  it('passes a slowdown inside the noise limit', () => {
    expect(verdict({ chat: 1_450 }).passed).toBe(true)
  })

  it('fails any extra process, and IPC calls past their race floor', () => {
    expect(verdict({ ipc: 26 }).passed).toBe(true)
    expect(verdict({ ipc: 27 }).regressions.map((row) => row.id)).toEqual([
      'cold.ipc-until-chat-ready',
      'warm.ipc-until-chat-ready',
    ])
    expect(verdict({ processes: 7 }).regressions.map((row) => row.id)).toEqual([
      'idle.processes',
      'after-turn.processes',
    ])
  })

  it('fails memory above both the relative and the absolute limit only', () => {
    expect(verdict({ rss: 620 * MIB }).passed).toBe(true)
    expect(verdict({ rss: 660 * MIB }).regressions.map((row) => row.id)).toEqual([
      'idle.rss',
      'after-turn.rss',
    ])
  })

  it('names a loosened threshold and needs the label for it', () => {
    const looser: Thresholds = { ...THRESHOLDS, timing: { relative: 0.2, absolute: 60 }, pairs: 2 }
    expect(loosenedThresholds(THRESHOLDS, looser)).toEqual([
      { name: 'timing.relative', base: 0.1, head: 0.2 },
      { name: 'pairs', base: 4, head: 2 },
    ])
    expect(verdict({}, [], looser).passed).toBe(false)
    expect(verdict({}, [REGRESSION_ACCEPTED_LABEL], looser).passed).toBe(true)
  })
})
