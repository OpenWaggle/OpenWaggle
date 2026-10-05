import { usageStatisticsDay } from '../../src/shared/usage-statistics/validation'

export const MS_PER_SECOND = 1000
export const MS_PER_DAY = 86_400_000

/** Days since the Unix epoch of the UTC day containing `time`. */
export function epochDay(time: number) {
  return Math.floor(time / MS_PER_DAY)
}

/** The UTC day containing `time`, as `YYYY-MM-DD`. */
export function utcDay(time: number) {
  return usageStatisticsDay(time)
}

/** The UTC day `days` after the one containing `time`, as `YYYY-MM-DD`. */
export function utcDayOffset(time: number, days: number) {
  return usageStatisticsDay((epochDay(time) + days) * MS_PER_DAY)
}
