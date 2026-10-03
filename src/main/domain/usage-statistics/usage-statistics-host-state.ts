/**
 * What the Session Host keeps between reports about this Install: markers for the events sent
 * once or once per period, which days are closed, the batch in flight, and the observations of
 * days not reported yet. Nothing here identifies the Install (ADR 0044).
 */
import { usageStatisticsDay, usageStatisticsEpochDay } from '@shared/usage-statistics/validation'
import {
  EMPTY_USAGE_STATISTICS_DAY,
  mergeUsageStatisticsDays,
  pruneUsageStatisticsDays,
  USAGE_STATISTICS_RETAINED_DAYS,
  type UsageStatisticsDay,
} from './usage-statistics-observations'

export const USAGE_STATISTICS_STATE_SCHEMA_VERSION = 2

export interface UsageStatisticsInstallState {
  /**
   * First UTC day this Install was used, which starts the install age: the oldest local evidence
   * of use (see {@link seedUsageStatisticsInstall}) or, without any, the first observation.
   */
  readonly firstSeenDay: string | null
  /** Whether the local evidence of earlier use is settled: read, or given up on. */
  readonly evidenceChecked: boolean
  /** Failed reads of that evidence; the reporter gives up after a few. */
  readonly evidenceFailures: number
  readonly newReported: boolean
  readonly onboardingReported: boolean
  /** Last day reported as `install.active`, for the first-this-week and -month flags. */
  readonly lastActiveDay: string | null
  /** Version of the last launch; a later launch of a higher version is an `update.installed`. */
  readonly lastLaunchedVersion: string | null
}

/**
 * Which days are closed. A closed day is never sent again, whether it was accepted, rejected,
 * dropped or its outcome is unknown. Days are closed one by one rather than through a single
 * high-water mark, so a day closed while the clock was wrong cannot hide the real days after it.
 */
export interface UsageStatisticsReportingState {
  /** Every day up to and including this one is closed; only a conservative reset sets it. */
  readonly closedThroughDay: string | null
  /** Closed days after `closedThroughDay` that are still inside the retained window. */
  readonly closedDays: readonly string[]
  /**
   * The day whose batch is being sent. Found when the Host starts, it means the previous Host
   * stopped mid-request, so the endpoint may have stored the batch: the day is closed unsent.
   */
  readonly inFlightDay: string | null
}

export interface UsageStatisticsHostState {
  readonly schemaVersion: typeof USAGE_STATISTICS_STATE_SCHEMA_VERSION
  readonly install: UsageStatisticsInstallState
  readonly reporting: UsageStatisticsReportingState
  readonly days: Readonly<Record<string, UsageStatisticsDay>>
}

export const INITIAL_USAGE_STATISTICS_HOST_STATE: UsageStatisticsHostState = {
  schemaVersion: USAGE_STATISTICS_STATE_SCHEMA_VERSION,
  install: {
    firstSeenDay: null,
    evidenceChecked: false,
    evidenceFailures: 0,
    newReported: false,
    onboardingReported: false,
    lastActiveDay: null,
    lastLaunchedVersion: null,
  },
  reporting: { closedThroughDay: null, closedDays: [], inFlightDay: null },
  days: {},
}

const MS_PER_DAY = 86_400_000
/**
 * Closed days kept, newest by date. A count, not a date window: a clock that runs far ahead must
 * not age out days the GUI file may still hold. Twice the retained window leaves room for days
 * closed while the clock was wrong.
 */
const MAX_CLOSED_DAYS = USAGE_STATISTICS_RETAINED_DAYS * 2

/** `day` moved by `offset` whole days. */
export function shiftUsageStatisticsDay(day: string, offset: number) {
  return usageStatisticsDay((epochDayOrThrow(day) + offset) * MS_PER_DAY)
}

/**
 * The state that replaces a file that cannot be read or decoded. Nothing it lost can be told
 * apart from what was already sent, so it assumes the worst for duplicates: every day before
 * today is closed, `install.new` and `install.onboarding` count as sent, and this week and month
 * already had an Active day. The install age is read again from local evidence.
 */
export function recoveredUsageStatisticsHostState(today: string): UsageStatisticsHostState {
  const yesterday = shiftUsageStatisticsDay(today, -1)
  return {
    schemaVersion: USAGE_STATISTICS_STATE_SCHEMA_VERSION,
    install: {
      firstSeenDay: null,
      evidenceChecked: false,
      evidenceFailures: 0,
      newReported: true,
      onboardingReported: true,
      lastActiveDay: yesterday,
      lastLaunchedVersion: null,
    },
    reporting: { closedThroughDay: yesterday, closedDays: [], inFlightDay: null },
    days: {},
  }
}

function epochDayOrThrow(day: string) {
  const epochDay = usageStatisticsEpochDay(day)
  if (epochDay === undefined) throw new Error(`Invalid Usage statistics day: ${day}`)
  return epochDay
}

/** What a closed day's batch said about the Install, when the endpoint may have stored it. */
export interface UsageStatisticsClosedReport {
  readonly includesInstallNew: boolean
  readonly includesActive: boolean
}

/** Whether `day` was already sent, dropped or abandoned and must never be sent again. */
export function isUsageStatisticsDayClosed(reporting: UsageStatisticsReportingState, day: string) {
  const closedThrough = reporting.closedThroughDay
  if (closedThrough !== null && epochDayOrThrow(day) <= epochDayOrThrow(closedThrough)) return true
  return reporting.closedDays.includes(day)
}

/** True once the endpoint would reject the day as too old. */
export function isUsageStatisticsDayExpired(day: string, today: string) {
  return epochDayOrThrow(day) <= epochDayOrThrow(today) - USAGE_STATISTICS_RETAINED_DAYS
}

/**
 * Completed days that are neither closed nor expired, oldest first. The first day is a candidate
 * even without observations, because it carries `install.new` and `install.onboarding`. Days
 * after `today` never are: they were recorded while the clock was ahead.
 */
export function reportableUsageStatisticsDays(input: {
  readonly state: UsageStatisticsHostState
  readonly guiDays: Readonly<Record<string, UsageStatisticsDay>>
  readonly today: string
}): readonly string[] {
  const todayEpochDay = epochDayOrThrow(input.today)
  const { install, reporting } = input.state
  const candidates = new Set([...Object.keys(input.state.days), ...Object.keys(input.guiDays)])
  if (install.firstSeenDay && (!install.newReported || !install.onboardingReported)) {
    candidates.add(install.firstSeenDay)
  }
  return [...candidates]
    .filter((day) => usageStatisticsEpochDay(day) !== undefined)
    .filter((day) => epochDayOrThrow(day) < todayEpochDay)
    .filter((day) => !isUsageStatisticsDayExpired(day, input.today))
    .filter((day) => !isUsageStatisticsDayClosed(reporting, day))
    .sort((left, right) => epochDayOrThrow(left) - epochDayOrThrow(right))
}

/** The Session Host and GUI observations of one day, combined. */
export function observationsForDay(
  hostDays: Readonly<Record<string, UsageStatisticsDay>>,
  guiDays: Readonly<Record<string, UsageStatisticsDay>>,
  day: string,
) {
  return mergeUsageStatisticsDays(
    hostDays[day] ?? EMPTY_USAGE_STATISTICS_DAY,
    guiDays[day] ?? EMPTY_USAGE_STATISTICS_DAY,
  )
}

function laterDay(left: string | null, right: string) {
  return left !== null && epochDayOrThrow(left) >= epochDayOrThrow(right) ? left : right
}

/** Closed days after the floor, at most a bounded number of the latest. */
function prunedClosedDays(reporting: UsageStatisticsReportingState) {
  const kept = reporting.closedDays
    .filter((day) => usageStatisticsEpochDay(day) !== undefined)
    .filter(
      (day) =>
        reporting.closedThroughDay === null ||
        epochDayOrThrow(day) > epochDayOrThrow(reporting.closedThroughDay),
    )
    .sort((left, right) => epochDayOrThrow(left) - epochDayOrThrow(right))
  return kept.slice(Math.max(0, kept.length - MAX_CLOSED_DAYS))
}

function sameDays(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((day, index) => day === right[index])
}

/**
 * Drops what can no longer be reported: expired days and days after `today`, and bounds the
 * closed days. A first day that expired before it was reported ends onboarding unsent. Returns
 * `state` itself when nothing changed.
 */
export function pruneUsageStatisticsHostState(
  state: UsageStatisticsHostState,
  today: string,
): UsageStatisticsHostState {
  const days = pruneUsageStatisticsDays(state.days, today)
  const closedDays = prunedClosedDays(state.reporting)
  const firstDay = state.install.firstSeenDay
  const onboardingExpired =
    !state.install.onboardingReported &&
    firstDay !== null &&
    isUsageStatisticsDayExpired(firstDay, today)
  if (
    days === state.days &&
    sameDays(closedDays, state.reporting.closedDays) &&
    !onboardingExpired
  ) {
    return state
  }
  return {
    ...state,
    days,
    reporting: { ...state.reporting, closedDays },
    install: onboardingExpired ? { ...state.install, onboardingReported: true } : state.install,
  }
}

/** Records that the batch for `day` is about to be sent. */
export function markUsageStatisticsDayInFlight(
  state: UsageStatisticsHostState,
  day: string,
): UsageStatisticsHostState {
  return { ...state, reporting: { ...state.reporting, inFlightDay: day } }
}

/** The send ended with nothing stored by the endpoint; the day stays queued for a retry. */
export function clearUsageStatisticsInFlightDay(
  state: UsageStatisticsHostState,
): UsageStatisticsHostState {
  if (state.reporting.inFlightDay === null) return state
  return { ...state, reporting: { ...state.reporting, inFlightDay: null } }
}

/**
 * Closes `day`: its observations are deleted, it joins the closed days and is never sent again.
 * `report` is the batch the endpoint may have stored (accepted, or sent with an unknown outcome),
 * whose Install markers are then kept as sent; `null` when nothing was stored.
 */
export function closeUsageStatisticsDay(
  state: UsageStatisticsHostState,
  day: string,
  report: UsageStatisticsClosedReport | null,
): UsageStatisticsHostState {
  const { [day]: _closed, ...days } = state.days
  const { install } = state
  const reporting: UsageStatisticsReportingState = {
    ...state.reporting,
    inFlightDay: null,
    closedDays: isUsageStatisticsDayClosed(state.reporting, day)
      ? state.reporting.closedDays
      : [...state.reporting.closedDays, day],
  }
  return {
    ...state,
    days,
    reporting: { ...reporting, closedDays: prunedClosedDays(reporting) },
    install: {
      ...install,
      newReported: install.newReported || report?.includesInstallNew === true,
      // A first day that has been closed can never send its onboarding.
      onboardingReported: install.onboardingReported || day === install.firstSeenDay,
      lastActiveDay: report?.includesActive
        ? laterDay(install.lastActiveDay, day)
        : install.lastActiveDay,
    },
  }
}
