import { USAGE_STATISTICS_MAX_EVENT_AGE_DAYS } from '@shared/usage-statistics/contract'
import { describe, expect, it } from 'vitest'
import {
  applyUsageStatisticsObservation,
  EMPTY_USAGE_STATISTICS_DAY,
  mergeUsageStatisticsDays,
  pruneUsageStatisticsDays,
  recordUsageStatisticsObservation,
  USAGE_STATISTICS_DAY_LIMITS,
  type UsageStatisticsDay,
  type UsageStatisticsObservation,
  type UsageStatisticsRunFinishedProperties,
} from '../usage-statistics-observations'

const RUN: UsageStatisticsRunFinishedProperties = {
  entry_point: 'app',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinking_level: 'medium',
  access_mode: 'yolo',
  waggle: false,
  result: 'completed',
  duration_s: 12,
  input_tokens: 1200,
  output_tokens: 300,
}

function many<T>(count: number, value: T) {
  return Array.from({ length: count }, () => value)
}

function applyAll(observations: readonly UsageStatisticsObservation[]) {
  return observations.reduce<UsageStatisticsDay>(
    (day, observation) => applyUsageStatisticsObservation(day, observation),
    EMPTY_USAGE_STATISTICS_DAY,
  )
}

describe('Usage statistics observations', () => {
  it('marks the day active and keeps each entry point and feature once', () => {
    const day = applyAll([
      { kind: 'run-started', entryPoint: 'cli' },
      { kind: 'run-started', entryPoint: 'cli' },
      { kind: 'run-started', entryPoint: 'agent' },
      { kind: 'feature', flag: 'worktree' },
      { kind: 'feature', flag: 'worktree' },
    ])

    expect(day.ranRun).toBe(true)
    expect(day.entryPoints).toEqual(['cli', 'agent'])
    expect(day.features).toEqual(['worktree'])
  })

  it('replaces anything that is not a catalog identifier with custom', () => {
    const day = applyAll([
      { kind: 'mcp-server', identifier: 'playwright' },
      { kind: 'mcp-server', identifier: 'My Private Server' },
      { kind: 'skill', identifier: '/Users/me/skills/secret' },
      { kind: 'skill', identifier: 'visualize' },
    ])

    expect(day.mcpServers).toEqual(['playwright', 'custom'])
    expect(day.skills).toEqual(['custom', 'visualize'])
  })

  it('drops run events that fail the published contract', () => {
    const day = applyAll([
      { kind: 'run-finished', properties: RUN },
      { kind: 'run-finished', properties: { ...RUN, provider: 'my provider' } },
      { kind: 'run-finished', properties: { ...RUN, duration_s: -1 } },
      { kind: 'run-compacted', mechanism: 'fallback' },
    ])

    expect(day.events).toEqual([
      { name: 'run.finished', properties: RUN },
      { name: 'run.compacted', properties: { mechanism: 'fallback' } },
    ])
  })

  it('bounds every open-ended part of a day', () => {
    const day = applyAll([
      ...many(USAGE_STATISTICS_DAY_LIMITS.appOpened + 5, { kind: 'app-opened' } as const),
      ...many(USAGE_STATISTICS_DAY_LIMITS.runEvents + 5, {
        kind: 'run-compacted',
        mechanism: 'native',
      } as const),
      ...many(USAGE_STATISTICS_DAY_LIMITS.updates + 5, {
        kind: 'update-installed',
        previousVersion: '1.0.0',
      } as const),
      ...Array.from({ length: USAGE_STATISTICS_DAY_LIMITS.listItems + 5 }, (_, index) => ({
        kind: 'mcp-server' as const,
        identifier: `server-${index}`,
      })),
    ])

    expect(day.appOpened).toBe(USAGE_STATISTICS_DAY_LIMITS.appOpened)
    expect(day.events).toHaveLength(USAGE_STATISTICS_DAY_LIMITS.runEvents)
    expect(day.updates).toHaveLength(USAGE_STATISTICS_DAY_LIMITS.updates)
    expect(day.mcpServers).toHaveLength(USAGE_STATISTICS_DAY_LIMITS.listItems)
  })

  it('ignores invalid versions and extension counts', () => {
    const day = applyAll([
      { kind: 'update-installed', previousVersion: 'not-a-version' },
      { kind: 'extensions-enabled', count: -3 },
      { kind: 'extensions-enabled', count: 4 },
      { kind: 'extensions-enabled', count: 2 },
    ])

    expect(day.updates).toEqual([])
    expect(day.extensionsEnabled).toBe(4)
  })

  it('keeps only update versions of the published shape, dropping dev and test builds', () => {
    const day = applyAll([
      { kind: 'update-installed', previousVersion: '1.0.0-dev' },
      { kind: 'update-installed', previousVersion: '0.0.0-test' },
      { kind: 'update-installed', previousVersion: '1.0.0-beta' },
      { kind: 'update-installed', previousVersion: '1.0.0-rc.2' },
      { kind: 'update-installed', previousVersion: '0.9.0' },
    ])

    expect(day.updates).toEqual(['1.0.0-rc.2', '0.9.0'])
  })

  it('merges GUI and Session Host observations of the same day', () => {
    const host = applyAll([
      { kind: 'run-started', entryPoint: 'app' },
      { kind: 'feature', flag: 'worktree' },
      { kind: 'extensions-enabled', count: 1 },
      { kind: 'run-finished', properties: RUN },
    ])
    const gui = applyAll([
      { kind: 'app-opened' },
      { kind: 'app-opened' },
      { kind: 'feature', flag: 'terminal' },
      { kind: 'feature', flag: 'worktree' },
      { kind: 'provider-connected' },
    ])

    const merged = mergeUsageStatisticsDays(host, gui)

    expect(merged).toMatchObject({
      ranRun: true,
      entryPoints: ['app'],
      features: ['worktree', 'terminal'],
      extensionsEnabled: 1,
      appOpened: 2,
      providerConnected: true,
      events: [{ name: 'run.finished', properties: RUN }],
    })
    expect(
      mergeUsageStatisticsDays(EMPTY_USAGE_STATISTICS_DAY, EMPTY_USAGE_STATISTICS_DAY),
    ).toEqual(EMPTY_USAGE_STATISTICS_DAY)
  })

  it('keeps only days the endpoint still accepts', () => {
    const today = '2026-10-02'
    const oldestAccepted = '2026-08-28'
    const tooOld = '2026-08-27'
    const days = {
      [today]: EMPTY_USAGE_STATISTICS_DAY,
      [oldestAccepted]: EMPTY_USAGE_STATISTICS_DAY,
      [tooOld]: EMPTY_USAGE_STATISTICS_DAY,
      'not-a-day': EMPTY_USAGE_STATISTICS_DAY,
    }

    expect(USAGE_STATISTICS_MAX_EVENT_AGE_DAYS).toBe(35)
    expect(Object.keys(pruneUsageStatisticsDays(days, today)).sort()).toEqual([
      oldestAccepted,
      today,
    ])
    expect(
      Object.keys(recordUsageStatisticsObservation(days, today, { kind: 'app-opened' })),
    ).not.toContain(tooOld)
  })

  it('drops days recorded while the clock was ahead', () => {
    const days = {
      '2026-10-02': EMPTY_USAGE_STATISTICS_DAY,
      '2030-01-01': EMPTY_USAGE_STATISTICS_DAY,
    }

    expect(Object.keys(pruneUsageStatisticsDays(days, '2026-10-02'))).toEqual(['2026-10-02'])
  })

  it('returns the same days when an observation changes nothing, so no file is rewritten', () => {
    const today = '2026-10-02'
    const once = recordUsageStatisticsObservation({}, today, { kind: 'feature', flag: 'terminal' })

    expect(
      recordUsageStatisticsObservation(once, today, { kind: 'feature', flag: 'terminal' }),
    ).toBe(once)
    expect(
      recordUsageStatisticsObservation(once, today, { kind: 'feature', flag: 'voice' }),
    ).not.toBe(once)
    expect(pruneUsageStatisticsDays(once, today)).toBe(once)
  })
})
