import type { UsageStatisticsEvent } from '@shared/usage-statistics/contract'
import {
  usageStatisticsEpochDay,
  validateUsageStatisticsContext,
  validateUsageStatisticsEvent,
} from '@shared/usage-statistics/validation'
import { describe, expect, it } from 'vitest'
import {
  INITIAL_USAGE_STATISTICS_HOST_STATE,
  type UsageStatisticsInstallState,
} from '../usage-statistics-host-state'
import {
  applyUsageStatisticsObservation,
  EMPTY_USAGE_STATISTICS_DAY,
  type UsageStatisticsDay,
  type UsageStatisticsObservation,
} from '../usage-statistics-observations'
import {
  buildUsageStatisticsDayReport,
  usageStatisticsExtensionsBucket,
  usageStatisticsInstallAge,
} from '../usage-statistics-report'

const TODAY = '2026-10-02'
const TODAY_EPOCH_DAY = usageStatisticsEpochDay(TODAY) ?? 0

function day(observations: readonly UsageStatisticsObservation[]): UsageStatisticsDay {
  return observations.reduce<UsageStatisticsDay>(
    applyUsageStatisticsObservation,
    EMPTY_USAGE_STATISTICS_DAY,
  )
}

function install(
  overrides: Partial<UsageStatisticsInstallState> = {},
): UsageStatisticsInstallState {
  return { ...INITIAL_USAGE_STATISTICS_HOST_STATE.install, ...overrides }
}

function expectValidEvents(events: readonly UsageStatisticsEvent[]) {
  for (const event of events) {
    expect(validateUsageStatisticsEvent(event, TODAY_EPOCH_DAY)).toEqual({ ok: true, value: event })
  }
}

const BUSY_FIRST_DAY = day([
  { kind: 'app-opened' },
  { kind: 'app-opened' },
  { kind: 'provider-connected' },
  { kind: 'run-started', entryPoint: 'app' },
  { kind: 'run-started', entryPoint: 'agent' },
  { kind: 'feature', flag: 'worker_session' },
  { kind: 'feature', flag: 'terminal' },
  { kind: 'mcp-server', identifier: 'playwright' },
  { kind: 'mcp-server', identifier: 'custom' },
  { kind: 'skill', identifier: 'visualize' },
  { kind: 'extensions-enabled', count: 3 },
  { kind: 'update-installed', previousVersion: '1.0.0-beta.3' },
  {
    kind: 'run-finished',
    properties: {
      entry_point: 'app',
      provider: 'openrouter',
      model: 'custom',
      thinking_level: 'high',
      access_mode: 'ask-for-approval',
      waggle: true,
      result: 'interrupted',
      duration_s: 95,
      input_tokens: 48_000,
      output_tokens: 2_100,
    },
  },
  { kind: 'run-compacted', mechanism: 'native' },
])

describe('Usage statistics day report', () => {
  it('buckets install age and enabled extensions', () => {
    expect(usageStatisticsInstallAge('2026-10-01', '2026-10-01')).toBe('0-7d')
    expect(usageStatisticsInstallAge('2026-09-23', '2026-10-01')).toBe('8-30d')
    expect(usageStatisticsInstallAge('2026-07-03', '2026-10-01')).toBe('31-90d')
    expect(usageStatisticsInstallAge('2026-01-01', '2026-10-01')).toBe('91-365d')
    expect(usageStatisticsInstallAge('2024-01-01', '2026-10-01')).toBe('>365d')
    expect([0, 1, 2, 5, 6].map(usageStatisticsExtensionsBucket)).toEqual([
      '0',
      '1',
      '2-5',
      '2-5',
      '>5',
    ])
  })

  it('reports the first day with install.new, onboarding and every observation', () => {
    const report = buildUsageStatisticsDayReport({
      day: '2026-10-01',
      observations: BUSY_FIRST_DAY,
      install: install({ firstSeenDay: '2026-10-01' }),
    })

    expect(report.events.map((event) => event.name)).toEqual([
      'install.new',
      'install.onboarding',
      'install.active',
      'app.opened',
      'app.opened',
      'update.installed',
      'run.finished',
      'run.compacted',
    ])
    expect(report.events[1]?.properties).toEqual({
      provider_within_first_day: true,
      run_within_first_day: true,
      project_within_first_day: true,
    })
    expect(report.events[2]?.properties).toEqual({
      first_this_week: true,
      first_this_month: true,
      install_age: '0-7d',
      entry_points: ['agent', 'app'],
      worker_session: true,
      terminal: true,
      mcp_servers: ['custom', 'playwright'],
      skills: ['visualize'],
      extensions_enabled: '2-5',
    })
    expect(report).toMatchObject({
      includesInstallNew: true,
      includesOnboarding: true,
      includesActive: true,
    })
    expectValidEvents(report.events)
    const context = {
      version: '1.0.0-beta.4',
      build_channel: 'beta',
      update_channel: 'beta',
      os: 'darwin',
      arch: 'arm64',
    }
    expect(validateUsageStatisticsContext(context).ok).toBe(true)
  })

  it('reports onboarding steps that did not happen as false', () => {
    const report = buildUsageStatisticsDayReport({
      day: '2026-10-01',
      observations: day([{ kind: 'app-opened' }]),
      install: install({ firstSeenDay: '2026-10-01' }),
    })

    expect(report.events.find((event) => event.name === 'install.onboarding')?.properties).toEqual({
      provider_within_first_day: false,
      run_within_first_day: false,
      project_within_first_day: false,
    })
    expect(report.events.some((event) => event.name === 'install.active')).toBe(false)
    expectValidEvents(report.events)
  })

  it('computes first-this-week and first-this-month from the last active day', () => {
    const active = day([{ kind: 'run-started', entryPoint: 'cli' }])
    const sameWeekNewMonth = buildUsageStatisticsDayReport({
      day: '2026-10-01',
      observations: active,
      install: install({
        firstSeenDay: '2026-09-01',
        newReported: true,
        onboardingReported: true,
        lastActiveDay: '2026-09-29',
      }),
    })
    const sameWeekSameMonth = buildUsageStatisticsDayReport({
      day: '2026-10-02',
      observations: active,
      install: install({
        firstSeenDay: '2026-09-01',
        newReported: true,
        onboardingReported: true,
        lastActiveDay: '2026-10-01',
      }),
    })

    expect(sameWeekNewMonth.events).toEqual([
      expect.objectContaining({
        name: 'install.active',
        properties: expect.objectContaining({
          first_this_week: false,
          first_this_month: true,
          install_age: '8-30d',
          entry_points: ['cli'],
          extensions_enabled: '0',
        }),
      }),
    ])
    expect(sameWeekSameMonth.events[0]?.properties).toMatchObject({
      first_this_week: false,
      first_this_month: false,
    })
    expectValidEvents([...sameWeekNewMonth.events, ...sameWeekSameMonth.events])
  })

  it('says nothing for a later day without observations', () => {
    const report = buildUsageStatisticsDayReport({
      day: '2026-10-01',
      observations: EMPTY_USAGE_STATISTICS_DAY,
      install: install({ firstSeenDay: '2026-09-20', onboardingReported: true }),
    })

    expect(report.events).toEqual([])
  })
})
