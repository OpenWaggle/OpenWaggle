import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_USAGE_STATISTICS_DAY,
  type UsageStatisticsDay,
} from '../../domain/usage-statistics/usage-statistics-observations'
import {
  runUsageStatisticsReporter,
  USAGE_STATISTICS_INITIAL_RETRY_DELAY_MS,
  USAGE_STATISTICS_REPORT_INTERVAL_MS,
} from '../usage-statistics-reporter'
import {
  ACTIVE,
  day,
  expectValidRequests,
  harness,
  hostState,
  names,
  OPENED,
  REPORTED,
  report,
} from './usage-statistics-reporter.test-harness'

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

describe('Usage statistics reporter', () => {
  it('sends each completed day once as a valid batch and never sends today', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({
        days: {
          '2026-10-01': ACTIVE,
          '2026-10-02': day([{ kind: 'run-compacted', mechanism: 'fallback' }]),
          '2026-10-03': OPENED,
        },
      }),
    })

    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 2 })
    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 0 })

    expect(names(requests)).toEqual([
      ['install.new@2026-10-01', 'install.onboarding@2026-10-01', 'install.active@2026-10-01'],
      ['run.compacted@2026-10-02'],
    ])
    expectValidRequests(requests)
    expect(Object.keys(file.persisted().days)).toEqual(['2026-10-03'])
    expect(file.persisted().reporting.closedDays).toEqual(['2026-10-01', '2026-10-02'])
    expect(file.persisted().install).toMatchObject({ ...REPORTED, lastActiveDay: '2026-10-01' })
  })

  it('ignores observations recorded for days after today', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-09': ACTIVE } }),
      guiDays: { '2026-10-08': OPENED },
    })

    await report(dependencies)

    expect(requests).toEqual([])
    expect(file.persisted().days).toEqual({})
  })

  it('merges GUI observations into the same day without counting them twice', async () => {
    const { requests, dependencies } = harness({
      state: hostState({
        install: REPORTED,
        days: { '2026-10-02': day([{ kind: 'run-started', entryPoint: 'cli' }]) },
      }),
      guiDays: { '2026-10-02': day([{ kind: 'app-opened' }, { kind: 'feature', flag: 'voice' }]) },
    })

    await report(dependencies)
    // The GUI file still holds the day; the day is closed, so it is not sent again.
    await report(dependencies)

    expectValidRequests(requests)
    expect(requests.map((request) => request.events)).toEqual([
      [
        expect.objectContaining({
          name: 'install.active',
          properties: expect.objectContaining({ entry_points: ['cli'], voice: true }),
        }),
        { name: 'app.opened', day: '2026-10-02', properties: {} },
      ],
    ])
  })

  it('drops days the endpoint would reject as too old without sending them', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({
        install: { firstSeenDay: '2026-08-01', newReported: true },
        days: { '2026-08-01': OPENED },
      }),
    })

    await report(dependencies)

    expect(requests).toEqual([])
    expect(file.persisted().days).toEqual({})
    expect(file.persisted().install.onboardingReported).toBe(true)
  })

  it('sends nothing while statistics are off or the platform cannot be described', async () => {
    const off = harness({ state: hostState({ days: { '2026-10-01': OPENED } }) })
    const unsupported = harness({ state: hostState({ days: { '2026-10-01': OPENED } }) })

    expect(await report({ ...off.dependencies, isEnabled: () => false })).toEqual({
      status: 'disabled',
    })
    expect(
      await report({ ...unsupported.dependencies, context: () => Effect.succeed(undefined) }),
    ).toEqual({ status: 'unsupported' })
    expect([...off.requests, ...unsupported.requests]).toEqual([])
  })

  it('reports at startup, backs off after failures and returns to the hourly schedule', async () => {
    const delays: number[] = []
    const { dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-01': OPENED } }),
      deliveries: [
        { outcome: 'retry', reason: 'not-connected' },
        { outcome: 'retry', reason: 'endpoint-unavailable', status: 502 },
      ],
    })

    const exit = await Effect.runPromiseExit(
      runUsageStatisticsReporter({
        ...dependencies,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return delays.length >= 4 ? Effect.interrupt : Effect.void
        },
      }),
    )

    expect(Exit.isInterrupted(exit)).toBe(true)
    expect(delays).toEqual([
      USAGE_STATISTICS_INITIAL_RETRY_DELAY_MS,
      USAGE_STATISTICS_INITIAL_RETRY_DELAY_MS * 2,
      USAGE_STATISTICS_REPORT_INTERVAL_MS,
      USAGE_STATISTICS_REPORT_INTERVAL_MS,
    ])
  })

  it('drops an update.installed whose version an older build recorded off the contract', async () => {
    // Written before the version shape was tightened; recording would refuse it now.
    const recordedByOlderBuild: UsageStatisticsDay = {
      ...EMPTY_USAGE_STATISTICS_DAY,
      appOpened: 1,
      updates: ['1.0.0-beta.3', '0.0.0-test'],
    }
    const { requests, dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-02': recordedByOlderBuild } }),
    })

    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 1 })

    expect(requests.map((request) => request.events)).toEqual([
      [
        { name: 'app.opened', day: '2026-10-02', properties: {} },
        {
          name: 'update.installed',
          day: '2026-10-02',
          properties: { previous_version: '1.0.0-beta.3' },
        },
      ],
    ])
    expectValidRequests(requests)
  })
})
