import { validateUsageStatisticsEvent } from '@shared/usage-statistics/validation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageStatisticsObservation } from '../../domain/usage-statistics/usage-statistics-observations'

const harness = vi.hoisted(() => {
  const observations: UsageStatisticsObservation[] = []
  return { enabled: true, observations }
})

vi.mock('../usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => harness.enabled,
}))
vi.mock('../usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: UsageStatisticsObservation) =>
    harness.observations.push(observation),
}))

import {
  addUsageStatisticsRunTokens,
  markUsageStatisticsRunStart,
  noteUsageStatisticsRunAccessMode,
  noteUsageStatisticsRunModel,
  noteUsageStatisticsRunProjectDefault,
  recordUsageStatisticsRunFinished,
  recordUsageStatisticsRunStarted,
  resetUsageStatisticsRunsForTests,
  type UsageStatisticsRunStartFacts,
} from '../usage-statistics-runs'

let now = 0
const ANY_DAY_EPOCH = 20_000

function start(runId: string, overrides: Partial<UsageStatisticsRunStartFacts> = {}) {
  recordUsageStatisticsRunStarted({
    runId,
    originCallerId: 'gui:local-user',
    waggle: false,
    attachments: false,
    access: { ceiling: null, sessionMode: null, globalDefault: 'yolo' },
    worktree: false,
    workerSession: false,
    ...overrides,
  })
}

function finish(
  runId: string,
  overrides: Partial<Parameters<typeof recordUsageStatisticsRunFinished>[0]> = {},
) {
  recordUsageStatisticsRunFinished({
    runId,
    originCallerId: 'gui:local-user',
    waggle: false,
    thinkingLevel: 'medium',
    terminalStatus: 'completed',
    ...overrides,
  })
}

function finishedEvent() {
  const event = harness.observations.find((observation) => observation.kind === 'run-finished')
  return event?.kind === 'run-finished' ? event.properties : undefined
}

describe('Usage statistics Run tracking', () => {
  beforeEach(() => {
    harness.enabled = true
    harness.observations.length = 0
    now = 1_000_000
    resetUsageStatisticsRunsForTests(() => now)
  })

  it('marks the day active with the entry point and every Run feature', () => {
    start('run-1', {
      originCallerId: 'session-agent:s:r',
      waggle: true,
      attachments: true,
      worktree: true,
      workerSession: true,
    })

    expect(harness.observations).toEqual([
      { kind: 'run-started', entryPoint: 'agent' },
      { kind: 'feature', flag: 'waggle' },
      { kind: 'feature', flag: 'attachment' },
      { kind: 'feature', flag: 'worktree' },
      { kind: 'feature', flag: 'worker_session' },
    ])
  })

  it('reports run.finished with the Pi model, summed tokens and duration', () => {
    markUsageStatisticsRunStart('run-1')
    now += 1_000
    start('run-1', {
      originCallerId: 'local-user:abc',
      access: { ceiling: null, sessionMode: 'ask-for-approval', globalDefault: 'yolo' },
    })
    noteUsageStatisticsRunModel('run-1', { provider: 'openai', model: 'gpt-5' }, 'high')
    noteUsageStatisticsRunModel('run-1', { provider: 'custom', model: 'custom' }, 'low')
    addUsageStatisticsRunTokens('run-1', 1_000, 200)
    addUsageStatisticsRunTokens('run-1', 1_500, 300)
    // An agent-requested Waggle inside the Run counts toward it and makes it a Waggle Run.
    addUsageStatisticsRunTokens('waggle-of-run-1', 500, 50)
    now += 41_400

    finish('run-1', {
      originCallerId: 'local-user:abc',
      terminalStatus: 'interrupted-by-interaction-timeout',
    })

    const properties = finishedEvent()
    expect(properties).toEqual({
      entry_point: 'cli',
      provider: 'openai',
      model: 'gpt-5',
      thinking_level: 'high',
      access_mode: 'ask-for-approval',
      waggle: true,
      result: 'interrupted',
      // Counted from the first mark, before the start lookup.
      duration_s: 42,
      input_tokens: 3_000,
      output_tokens: 550,
    })
    expect(
      validateUsageStatisticsEvent(
        { name: 'run.finished', day: '2024-10-04', properties },
        ANY_DAY_EPOCH,
      ).ok,
    ).toBe(true)
    expect(harness.observations).toContainEqual({ kind: 'feature', flag: 'waggle' })
  })

  it('includes the project default the Run loaded at its start', () => {
    start('run-1')
    noteUsageStatisticsRunModel('run-1', { provider: 'openai', model: 'gpt-5' }, 'high')
    noteUsageStatisticsRunProjectDefault('run-1', 'ask-for-approval')

    finish('run-1')

    expect(finishedEvent()?.access_mode).toBe('ask-for-approval')
  })

  it('reports the mode the Run resolved for an approval over the one it started with', () => {
    start('run-1')
    noteUsageStatisticsRunModel('run-1', { provider: 'openai', model: 'gpt-5' }, 'high')
    noteUsageStatisticsRunAccessMode('run-1', 'ask-for-approval')

    finish('run-1')

    expect(finishedEvent()?.access_mode).toBe('ask-for-approval')
  })

  it('reports nothing for a Run that never reached a model', () => {
    start('run-2')
    harness.observations.length = 0

    finish('run-2')

    expect(harness.observations).toEqual([])
  })

  it('tracks nothing while statistics are off and forgets a Run once it settles', () => {
    harness.enabled = false
    start('run-3')
    noteUsageStatisticsRunModel('run-3', { provider: 'openai', model: 'gpt-5' }, 'high')
    harness.enabled = true
    finish('run-3')

    noteUsageStatisticsRunModel('run-4', { provider: 'openai', model: 'gpt-5' }, 'high')
    harness.enabled = false
    finish('run-4')
    harness.enabled = true
    finish('run-4')

    expect(harness.observations).toEqual([])
  })
})
