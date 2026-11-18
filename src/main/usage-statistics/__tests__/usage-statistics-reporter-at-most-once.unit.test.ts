import type { UsageStatisticsRequest } from '@shared/usage-statistics/contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it, vi } from 'vitest'
import { recoveredUsageStatisticsHostState } from '../../domain/usage-statistics/usage-statistics-host-state'
import {
  abandonInterruptedUsageStatisticsDay,
  reportCompletedUsageStatisticsDays,
  runUsageStatisticsReporter,
} from '../usage-statistics-reporter'
import {
  ACTIVE,
  expectValidRequests,
  harness,
  hostState,
  NOW,
  names,
  OPENED,
  REPORTED,
  report,
} from './usage-statistics-reporter.test-harness'

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

describe('Usage statistics reporter, at most once', () => {
  it('saves the day as in flight before its request and clears it after the answer', async () => {
    const { file, inFlightOnDisk, dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-02': OPENED } }),
    })

    await report(dependencies)

    expect(inFlightOnDisk).toEqual(['2026-10-02'])
    expect(file.persisted().reporting.inFlightDay).toBeNull()
  })

  it('sends nothing when the state or the in-flight marker cannot be saved', async () => {
    // Flush 1 saves the housekeeping before a report; flush 2 saves the marker.
    for (const failing of [1, 2]) {
      const { requests, dependencies } = harness({
        state: hostState({ install: REPORTED, days: { '2026-10-02': OPENED } }),
        failingFlush: (flushNumber) => flushNumber === failing,
      })

      expect(await report(dependencies)).toEqual({
        status: 'retry',
        sentDays: 0,
        reason: 'state not saved',
      })
      expect(requests).toEqual([])
    }
  })

  it('retries only when the endpoint stored nothing, and then sends the same batch', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-02': OPENED } }),
      deliveries: [
        { outcome: 'retry', reason: 'endpoint-unavailable', status: 503 },
        { outcome: 'retry', reason: 'endpoint-unavailable', status: 429 },
        { outcome: 'retry', reason: 'not-connected' },
      ],
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await report(dependencies)).toMatchObject({ status: 'retry' })
      expect(file.persisted().reporting.inFlightDay).toBeNull()
      expect(file.persisted().days['2026-10-02']).toBeDefined()
    }
    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 1 })
    expect(requests).toHaveLength(4)
    expect(new Set(requests.map((request) => JSON.stringify(request))).size).toBe(1)
  })

  it('closes a day whose outcome is unknown and never sends it or its markers again', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({ days: { '2026-10-01': ACTIVE } }),
      deliveries: [{ outcome: 'unknown', reason: 'TimeoutError' }],
    })

    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 0 })
    file.update((state) => ({ ...state, days: { '2026-10-02': ACTIVE } }))
    await report(dependencies)

    expect(names(requests)).toEqual([
      ['install.new@2026-10-01', 'install.onboarding@2026-10-01', 'install.active@2026-10-01'],
      ['install.active@2026-10-02'],
    ])
    expect(file.persisted().install).toMatchObject({ ...REPORTED, lastActiveDay: '2026-10-02' })
  })

  it('does not resend a day when the Host stopped while its request was pending', async () => {
    const first = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-01': ACTIVE } }),
    })
    const received = Promise.withResolvers<void>()
    const pending = {
      ...first.dependencies,
      send: (request: UsageStatisticsRequest) =>
        Effect.sync(() => {
          first.requests.push(request)
          received.resolve()
        }).pipe(Effect.zipRight(Effect.never)),
    }
    const fiber = Effect.runFork(reportCompletedUsageStatisticsDays(pending))
    await received.promise
    await Effect.runPromise(Fiber.interrupt(fiber))

    // The next Host starts from what was on disk, and closes the interrupted day first.
    const restarted = harness({ state: first.file.persisted(), now: NOW + 3_600_000 })
    await Effect.runPromise(abandonInterruptedUsageStatisticsDay(restarted.dependencies))
    expect(await report(restarted.dependencies)).toEqual({ status: 'done', sentDays: 0 })

    expect(first.requests).toHaveLength(1)
    expect(restarted.requests).toEqual([])
    expect(restarted.file.persisted().reporting).toMatchObject({
      inFlightDay: null,
      closedDays: ['2026-10-01'],
    })
    expect(restarted.file.persisted().install.lastActiveDay).toBe('2026-10-01')
  })

  it('drops a rejected day without hiding the days after it', async () => {
    const { requests, dependencies } = harness({
      state: hostState({
        install: REPORTED,
        days: { '2026-10-01': OPENED, '2026-10-02': ACTIVE },
      }),
      deliveries: [{ outcome: 'rejected', status: 400 }],
    })

    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 1 })
    expect(names(requests)).toEqual([['app.opened@2026-10-01'], ['install.active@2026-10-02']])
  })

  it('still reports real days after a day closed while the clock ran ahead', async () => {
    const ahead = harness({
      state: hostState({
        install: REPORTED,
        reporting: { closedThroughDay: '2026-09-30' },
        days: { '2030-01-01': ACTIVE },
      }),
      deliveries: [{ outcome: 'rejected', status: 400 }],
      now: Date.parse('2030-01-02T08:00:00.000Z'),
    })
    await report(ahead.dependencies)

    const corrected = harness({
      state: {
        ...ahead.file.persisted(),
        days: { '2026-10-01': ACTIVE, '2026-10-02': OPENED },
      },
    })
    await report(corrected.dependencies)

    expect(names(corrected.requests)).toEqual([
      ['install.active@2026-10-01'],
      ['app.opened@2026-10-02'],
    ])
    expectValidRequests(corrected.requests)
  })

  it('does not resend history or one-time events after the state file was lost', async () => {
    const { requests, dependencies } = harness({
      state: recoveredUsageStatisticsHostState('2026-10-03'),
      guiDays: { '2026-09-20': OPENED, '2026-10-01': OPENED, '2026-10-03': OPENED },
      evidenceDay: '2026-03-01',
    })

    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 0 })
    expect(requests).toEqual([])
  })

  it('does not count an Install with earlier local evidence as new, and ages it from there', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({
        install: { firstSeenDay: '2026-10-03', evidenceChecked: false },
        days: { '2026-10-02': ACTIVE },
      }),
      evidenceDay: '2026-06-01',
    })

    await report(dependencies)

    expect(names(requests)).toEqual([['install.active@2026-10-02']])
    expect(requests[0]?.events[0]?.properties).toMatchObject({ install_age: '91-365d' })
    expect(file.persisted().install).toMatchObject({
      firstSeenDay: '2026-06-01',
      evidenceChecked: true,
      ...REPORTED,
    })
  })

  it('counts an Install without earlier evidence as new on its first report', async () => {
    const { requests, dependencies } = harness({
      state: hostState({
        install: { firstSeenDay: '2026-10-02', evidenceChecked: false },
        days: { '2026-10-02': ACTIVE },
      }),
      evidenceDay: '2026-10-02',
    })

    await report(dependencies)

    expect(names(requests)).toEqual([
      ['install.new@2026-10-02', 'install.onboarding@2026-10-02', 'install.active@2026-10-02'],
    ])
    expectValidRequests(requests)
  })

  it('holds every report while the evidence cannot be read, then gives up after three reads', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({
        install: { firstSeenDay: '2026-10-01', evidenceChecked: false },
        days: { '2026-10-01': ACTIVE },
      }),
    })
    const failing = {
      ...dependencies,
      installEvidenceTime: () => Effect.fail(new Error('database is locked')),
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      expect(await report(failing)).toEqual({
        status: 'retry',
        sentDays: 0,
        reason: 'install evidence unavailable',
      })
      expect(file.persisted().install).toMatchObject({
        evidenceChecked: false,
        evidenceFailures: attempt,
      })
    }
    expect(requests).toEqual([])

    // The third failure settles the evidence as absent; the held day goes out once.
    expect(await report(failing)).toEqual({ status: 'done', sentDays: 1 })
    expect(names(requests)).toEqual([
      ['install.new@2026-10-01', 'install.onboarding@2026-10-01', 'install.active@2026-10-01'],
    ])
  })

  it('does not count an existing Install as new after one failed evidence read', async () => {
    let reads = 0
    const { file, requests, dependencies } = harness({
      state: hostState({
        install: { firstSeenDay: '2026-10-03', evidenceChecked: false },
        days: { '2026-10-02': ACTIVE },
      }),
    })
    const flaky = {
      ...dependencies,
      installEvidenceTime: () =>
        Effect.suspend(() => {
          reads += 1
          return reads === 1
            ? Effect.fail(new Error('database is locked'))
            : Effect.succeed(Date.parse('2026-04-01T09:00:00.000Z'))
        }),
    }

    expect(await report(flaky)).toMatchObject({ status: 'retry' })
    expect(await report(flaky)).toEqual({ status: 'done', sentDays: 1 })

    expect(names(requests)).toEqual([['install.active@2026-10-02']])
    expect(file.persisted().install).toMatchObject({ firstSeenDay: '2026-04-01', ...REPORTED })
  })

  it('sends a new Install’s first day after its in-flight marker failed to save once', async () => {
    // Flush 1 saves the housekeeping before a report; flush 2 is the first marker write.
    const { file, requests, dependencies } = harness({
      state: hostState({ days: { '2026-10-01': ACTIVE } }),
      failingFlush: (flushNumber) => flushNumber === 2,
    })

    expect(await report(dependencies)).toEqual({
      status: 'retry',
      sentDays: 0,
      reason: 'state not saved',
    })
    expect(file.read().reporting.inFlightDay).toBeNull()
    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 1 })

    expect(names(requests)).toEqual([
      ['install.new@2026-10-01', 'install.onboarding@2026-10-01', 'install.active@2026-10-01'],
    ])
    expect(file.persisted().install).toMatchObject(REPORTED)
  })

  it('closes only the day a previous Host left in flight, once, when the reporter starts', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({
        install: REPORTED,
        reporting: { inFlightDay: '2026-10-01' },
        days: { '2026-10-01': ACTIVE, '2026-10-02': ACTIVE },
      }),
    })
    let sleeps = 0

    await Effect.runPromiseExit(
      runUsageStatisticsReporter({
        ...dependencies,
        sleep: () => {
          sleeps += 1
          return sleeps >= 1 ? Effect.interrupt : Effect.void
        },
      }),
    )

    expect(names(requests)).toEqual([['install.active@2026-10-02']])
    expect(file.persisted().reporting).toMatchObject({
      inFlightDay: null,
      closedDays: ['2026-10-01', '2026-10-02'],
    })
  })

  it('treats a transport defect as an unknown outcome and never resends the day', async () => {
    const { file, requests, dependencies } = harness({
      state: hostState({ install: REPORTED, days: { '2026-10-02': ACTIVE } }),
    })
    const defective = {
      ...dependencies,
      send: (request: UsageStatisticsRequest) =>
        Effect.sync(() => requests.push(request)).pipe(Effect.zipRight(Effect.die('socket bug'))),
    }

    expect(await report(defective)).toEqual({ status: 'done', sentDays: 0 })
    expect(await report(dependencies)).toEqual({ status: 'done', sentDays: 0 })

    expect(requests).toHaveLength(1)
    expect(file.persisted().reporting).toMatchObject({
      inFlightDay: null,
      closedDays: ['2026-10-02'],
    })
  })
})
