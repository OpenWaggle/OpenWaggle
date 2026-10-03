/**
 * Local evidence of an Install's earlier use, read once from data the app already keeps, so an
 * Install that predates Usage statistics is never reported as new (see the host state).
 */
import { usageStatisticsDay, usageStatisticsEpochDay } from '@shared/usage-statistics/validation'
import type { UsageStatisticsHostState } from './usage-statistics-host-state'

const MS_PER_DAY = 86_400_000
/** Failed evidence reads before the reporter treats the evidence as absent. */
export const USAGE_STATISTICS_MAX_EVIDENCE_READ_FAILURES = 3
/**
 * Slack between the evidence and the first recorded day: the database of a new Install is
 * created moments before its first observation, which may fall just after midnight UTC.
 */
const EVIDENCE_TOLERANCE_MS = 600_000

/** Start of a UTC day in ms, or `undefined` for something that is not a day. */
function dayStart(day: string) {
  const epochDay = usageStatisticsEpochDay(day)
  return epochDay === undefined ? undefined : epochDay * MS_PER_DAY
}

/**
 * Applies the local evidence of earlier use once: `evidenceTime` is when this profile was first
 * used, read from data the app already keeps (its oldest Session, its database). Evidence from
 * before the first day Usage statistics recorded anything (or, without one, before today), by
 * more than a few minutes, means the Install predates them: it is not new, its first day and
 * onboarding are history and count as sent, and its age starts at the evidence. A new Install's
 * evidence is from its first recorded day, so it stays new.
 */
export function seedUsageStatisticsInstall(
  state: UsageStatisticsHostState,
  evidenceTime: number | null,
  today: string,
): UsageStatisticsHostState {
  if (state.install.evidenceChecked) return state
  const install = { ...state.install, evidenceChecked: true }
  const recordedSince = dayStart(install.firstSeenDay ?? today) ?? dayStart(today)
  const predatesStatistics =
    evidenceTime !== null &&
    recordedSince !== undefined &&
    Number.isFinite(evidenceTime) &&
    evidenceTime < recordedSince - EVIDENCE_TOLERANCE_MS
  if (!predatesStatistics) return { ...state, install }
  return {
    ...state,
    install: {
      ...install,
      firstSeenDay: usageStatisticsDay(evidenceTime),
      newReported: true,
      onboardingReported: true,
    },
  }
}

/** One failed evidence read; after a few, the evidence counts as absent and is settled. */
export function recordUsageStatisticsEvidenceFailure(
  state: UsageStatisticsHostState,
): UsageStatisticsHostState {
  if (state.install.evidenceChecked) return state
  const evidenceFailures = state.install.evidenceFailures + 1
  return {
    ...state,
    install: {
      ...state.install,
      evidenceFailures,
      evidenceChecked: evidenceFailures >= USAGE_STATISTICS_MAX_EVIDENCE_READ_FAILURES,
    },
  }
}
