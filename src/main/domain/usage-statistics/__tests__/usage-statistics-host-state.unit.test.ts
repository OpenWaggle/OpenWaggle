import { describe, expect, it } from 'vitest'
import {
  closeUsageStatisticsDay,
  INITIAL_USAGE_STATISTICS_HOST_STATE,
  isUsageStatisticsDayClosed,
  isUsageStatisticsDayExpired,
  markUsageStatisticsDayInFlight,
  pruneUsageStatisticsHostState,
  recoveredUsageStatisticsHostState,
  reportableUsageStatisticsDays,
  shiftUsageStatisticsDay,
  type UsageStatisticsHostState,
  type UsageStatisticsInstallState,
} from '../usage-statistics-host-state'
import {
  recordUsageStatisticsEvidenceFailure,
  seedUsageStatisticsInstall,
} from '../usage-statistics-install-evidence'
import {
  applyUsageStatisticsObservation,
  EMPTY_USAGE_STATISTICS_DAY,
} from '../usage-statistics-observations'

const TODAY = '2026-10-02'
const ACTIVE_DAY = applyUsageStatisticsObservation(EMPTY_USAGE_STATISTICS_DAY, {
  kind: 'run-started',
  entryPoint: 'app',
})

function state(
  input: {
    readonly install?: Partial<UsageStatisticsInstallState>
    readonly reporting?: Partial<UsageStatisticsHostState['reporting']>
    readonly days?: UsageStatisticsHostState['days']
  } = {},
): UsageStatisticsHostState {
  return {
    ...INITIAL_USAGE_STATISTICS_HOST_STATE,
    install: { ...INITIAL_USAGE_STATISTICS_HOST_STATE.install, ...input.install },
    reporting: { ...INITIAL_USAGE_STATISTICS_HOST_STATE.reporting, ...input.reporting },
    days: input.days ?? {},
  }
}

describe('Usage statistics host state', () => {
  it('lists completed days that are neither closed nor expired, oldest first', () => {
    const current = state({
      install: { firstSeenDay: '2026-09-28' },
      reporting: { closedDays: ['2026-09-29'] },
      days: {
        '2026-08-01': ACTIVE_DAY,
        '2026-09-29': ACTIVE_DAY,
        '2026-09-30': ACTIVE_DAY,
        [TODAY]: ACTIVE_DAY,
        '2026-10-09': ACTIVE_DAY,
      },
    })

    expect(
      reportableUsageStatisticsDays({
        state: current,
        guiDays: { '2026-10-01': EMPTY_USAGE_STATISTICS_DAY, 'not-a-day': ACTIVE_DAY },
        today: TODAY,
      }),
    ).toEqual(['2026-09-28', '2026-09-30', '2026-10-01'])
  })

  it('closes a day for good and keeps the markers of a batch the endpoint may have stored', () => {
    const current = markUsageStatisticsDayInFlight(
      state({ install: { firstSeenDay: '2026-10-01' }, days: { '2026-10-01': ACTIVE_DAY } }),
      '2026-10-01',
    )

    const closed = closeUsageStatisticsDay(current, '2026-10-01', {
      includesInstallNew: true,
      includesActive: true,
    })

    expect(closed.days).toEqual({})
    expect(closed.reporting).toEqual({
      closedThroughDay: null,
      closedDays: ['2026-10-01'],
      inFlightDay: null,
    })
    expect(closed.install).toMatchObject({
      newReported: true,
      onboardingReported: true,
      lastActiveDay: '2026-10-01',
    })
    expect(isUsageStatisticsDayClosed(closed.reporting, '2026-10-01')).toBe(true)
  })

  it('keeps install.new pending when the endpoint stored nothing', () => {
    const closed = closeUsageStatisticsDay(
      state({ install: { firstSeenDay: '2026-09-30' } }),
      '2026-10-01',
      null,
    )

    expect(closed.install).toMatchObject({ newReported: false, lastActiveDay: null })
    expect(closed.reporting.closedDays).toEqual(['2026-10-01'])
  })

  it('does not let a day closed while the clock ran ahead hide the real days after it', () => {
    // The clock read 2030-01-02, so the Host closed 2030-01-01 (the endpoint rejected it).
    const excursion = closeUsageStatisticsDay(
      state({ reporting: { closedThroughDay: '2026-09-30' } }),
      '2030-01-01',
      null,
    )
    const corrected = {
      ...excursion,
      days: { '2026-10-01': ACTIVE_DAY, '2026-10-02': ACTIVE_DAY },
    }

    expect(
      reportableUsageStatisticsDays({ state: corrected, guiDays: {}, today: '2026-10-03' }),
    ).toEqual(['2026-10-01', '2026-10-02'])
  })

  it('prunes expired and future days, expires an unreported first day, and keeps closed days', () => {
    const current = state({
      install: { firstSeenDay: '2026-08-01' },
      reporting: { closedDays: ['2026-08-02', '2026-09-30'] },
      days: { '2026-08-03': ACTIVE_DAY, '2026-10-01': ACTIVE_DAY, '2026-10-05': ACTIVE_DAY },
    })

    const pruned = pruneUsageStatisticsHostState(current, TODAY)

    expect(Object.keys(pruned.days)).toEqual(['2026-10-01'])
    // Closed days are bounded by count, not by a date the clock may have wrong.
    expect(pruned.reporting.closedDays).toEqual(['2026-08-02', '2026-09-30'])
    expect(pruned.install.onboardingReported).toBe(true)
    expect(pruneUsageStatisticsHostState(pruned, TODAY)).toBe(pruned)
  })

  it('does not send reported GUI days again after the clock ran more than 36 days ahead', () => {
    const reported = closeUsageStatisticsDay(state(), '2026-10-01', null)
    // The Host reports once while its clock reads 2026-12-15, then the clock is corrected.
    const ahead = pruneUsageStatisticsHostState(reported, '2026-12-15')

    expect(
      reportableUsageStatisticsDays({
        state: ahead,
        guiDays: { '2026-10-01': ACTIVE_DAY },
        today: TODAY,
      }),
    ).toEqual([])
  })

  it('keeps at most 72 closed days, dropping the oldest', () => {
    let current = state()
    for (let offset = 0; offset < 80; offset += 1) {
      current = closeUsageStatisticsDay(
        current,
        shiftUsageStatisticsDay('2026-07-01', offset),
        null,
      )
    }

    expect(current.reporting.closedDays).toHaveLength(72)
    expect(current.reporting.closedDays[0]).toBe(shiftUsageStatisticsDay('2026-07-01', 8))
  })

  it('treats a day outside the accepted window as expired', () => {
    expect(isUsageStatisticsDayExpired('2026-08-28', TODAY)).toBe(false)
    expect(isUsageStatisticsDayExpired('2026-08-27', TODAY)).toBe(true)
  })

  it('does not count an Install with earlier local evidence of use as new', () => {
    const seeded = seedUsageStatisticsInstall(
      state({ install: { firstSeenDay: TODAY } }),
      Date.parse('2025-03-14T16:20:00.000Z'),
      TODAY,
    )

    expect(seeded.install).toMatchObject({
      firstSeenDay: '2025-03-14',
      evidenceChecked: true,
      newReported: true,
      onboardingReported: true,
    })
    // Evidence is read once.
    expect(seedUsageStatisticsInstall(seeded, Date.parse('2020-01-01T00:00:00.000Z'), TODAY)).toBe(
      seeded,
    )
  })

  it('keeps a new Install new when its evidence is from its first recorded day or missing', () => {
    // First report of a new Install, the day after its first launch.
    for (const evidenceTime of [Date.parse('2026-10-01T08:00:00.000Z'), null]) {
      const seeded = seedUsageStatisticsInstall(
        state({ install: { firstSeenDay: '2026-10-01' } }),
        evidenceTime,
        TODAY,
      )
      expect(seeded.install).toMatchObject({
        firstSeenDay: '2026-10-01',
        evidenceChecked: true,
        newReported: false,
        onboardingReported: false,
      })
    }
  })

  it('allows a few minutes between a new database and the first recorded day', () => {
    const firstDay = state({ install: { firstSeenDay: '2026-10-01' } })

    // Created just before midnight UTC; first observation just after.
    const justBefore = seedUsageStatisticsInstall(
      firstDay,
      Date.parse('2026-09-30T23:55:00.000Z'),
      TODAY,
    )
    const longBefore = seedUsageStatisticsInstall(
      firstDay,
      Date.parse('2026-09-30T23:40:00.000Z'),
      TODAY,
    )

    expect(justBefore.install).toMatchObject({ firstSeenDay: '2026-10-01', newReported: false })
    expect(longBefore.install).toMatchObject({ firstSeenDay: '2026-09-30', newReported: true })
  })

  it('compares evidence with today when nothing was recorded yet', () => {
    const seeded = seedUsageStatisticsInstall(
      state(),
      Date.parse('2026-10-01T10:00:00.000Z'),
      TODAY,
    )

    expect(seeded.install).toMatchObject({ firstSeenDay: '2026-10-01', newReported: true })
  })

  it('settles the evidence as absent after three failed reads', () => {
    const once = recordUsageStatisticsEvidenceFailure(state())
    const twice = recordUsageStatisticsEvidenceFailure(once)
    const thrice = recordUsageStatisticsEvidenceFailure(twice)

    expect([once, twice, thrice].map((current) => current.install.evidenceChecked)).toEqual([
      false,
      false,
      true,
    ])
    expect(thrice.install.evidenceFailures).toBe(3)
    expect(recordUsageStatisticsEvidenceFailure(thrice)).toBe(thrice)
    // Settled evidence is not read again.
    expect(seedUsageStatisticsInstall(thrice, Date.parse('2020-01-01T00:00:00.000Z'), TODAY)).toBe(
      thrice,
    )
  })

  it('recovers from a lost file without sending its history or its one-time events again', () => {
    const recovered = recoveredUsageStatisticsHostState(TODAY)

    expect(recovered.reporting).toEqual({
      closedThroughDay: '2026-10-01',
      closedDays: [],
      inFlightDay: null,
    })
    expect(recovered.install).toMatchObject({
      firstSeenDay: null,
      evidenceChecked: false,
      newReported: true,
      onboardingReported: true,
      lastActiveDay: '2026-10-01',
    })
    expect(
      reportableUsageStatisticsDays({
        state: recovered,
        guiDays: { '2026-09-20': ACTIVE_DAY, '2026-10-01': ACTIVE_DAY },
        today: TODAY,
      }),
    ).toEqual([])
  })

  it('moves a day by whole days across month and year ends', () => {
    expect(shiftUsageStatisticsDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftUsageStatisticsDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})
