/**
 * Turns one completed UTC day of observations into the events the endpoint accepts. Everything a
 * report needs to say about the Install over time (first report, install age, first active day of
 * the week or month) comes from these locally kept markers, never from an identifier (ADR 0044).
 */
import {
  type USAGE_STATISTICS_EXTENSION_BUCKETS,
  USAGE_STATISTICS_FEATURE_FLAGS,
  type USAGE_STATISTICS_INSTALL_AGES,
  type UsageStatisticsEvent,
  type UsageStatisticsValue,
} from '@shared/usage-statistics/contract'
import { usageStatisticsEpochDay } from '@shared/usage-statistics/validation'
import type { UsageStatisticsInstallState } from './usage-statistics-host-state'
import type { UsageStatisticsDay } from './usage-statistics-observations'

type InstallAge = (typeof USAGE_STATISTICS_INSTALL_AGES)[number]
type ExtensionsBucket = (typeof USAGE_STATISTICS_EXTENSION_BUCKETS)[number]

const DAYS_PER_WEEK = 7
const INSTALL_AGE_FIRST_WEEK_MAX_DAYS = 7
const INSTALL_AGE_FIRST_MONTH_MAX_DAYS = 30
const INSTALL_AGE_FIRST_QUARTER_MAX_DAYS = 90
const INSTALL_AGE_FIRST_YEAR_MAX_DAYS = 365
const EXTENSIONS_SMALL_BUCKET_MAX = 5
const MONDAY_OFFSET_FROM_EPOCH = 3
const MONTH_KEY_LENGTH = 7

function epochDayOrThrow(day: string) {
  const epochDay = usageStatisticsEpochDay(day)
  if (epochDay === undefined) throw new Error(`Invalid Usage statistics day: ${day}`)
  return epochDay
}

export function usageStatisticsInstallAge(firstSeenDay: string, day: string): InstallAge {
  const age = Math.max(0, epochDayOrThrow(day) - epochDayOrThrow(firstSeenDay))
  if (age <= INSTALL_AGE_FIRST_WEEK_MAX_DAYS) return '0-7d'
  if (age <= INSTALL_AGE_FIRST_MONTH_MAX_DAYS) return '8-30d'
  if (age <= INSTALL_AGE_FIRST_QUARTER_MAX_DAYS) return '31-90d'
  if (age <= INSTALL_AGE_FIRST_YEAR_MAX_DAYS) return '91-365d'
  return '>365d'
}

export function usageStatisticsExtensionsBucket(count: number): ExtensionsBucket {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  return count <= EXTENSIONS_SMALL_BUCKET_MAX ? '2-5' : '>5'
}

/** The ISO (Monday-based) week of a UTC day, as the epoch day of that week's Monday. */
function isoWeekKey(day: string) {
  const epochDay = epochDayOrThrow(day)
  const daysSinceMonday =
    (((epochDay + MONDAY_OFFSET_FROM_EPOCH) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK
  return epochDay - daysSinceMonday
}

function monthKey(day: string) {
  return day.slice(0, MONTH_KEY_LENGTH)
}

function installActiveProperties(
  day: string,
  observations: UsageStatisticsDay,
  install: UsageStatisticsInstallState,
) {
  const last = install.lastActiveDay
  const properties: Record<string, UsageStatisticsValue> = {
    first_this_week: last === null || isoWeekKey(last) !== isoWeekKey(day),
    first_this_month: last === null || monthKey(last) !== monthKey(day),
    install_age: usageStatisticsInstallAge(install.firstSeenDay ?? day, day),
    entry_points: [...observations.entryPoints].sort(),
    extensions_enabled: usageStatisticsExtensionsBucket(observations.extensionsEnabled ?? 0),
  }
  for (const flag of USAGE_STATISTICS_FEATURE_FLAGS) {
    if (observations.features.includes(flag)) properties[flag] = true
  }
  if (observations.mcpServers.length > 0)
    properties.mcp_servers = [...observations.mcpServers].sort()
  if (observations.skills.length > 0) properties.skills = [...observations.skills].sort()
  return properties
}

/** Onboarding steps of the Install's first day. Every later step implies the earlier ones. */
function onboardingProperties(firstDay: UsageStatisticsDay) {
  return {
    provider_within_first_day: firstDay.providerConnected || firstDay.ranRun,
    run_within_first_day: firstDay.ranRun,
    project_within_first_day: firstDay.projectOpened || firstDay.ranRun,
  }
}

export interface UsageStatisticsDayReport {
  readonly events: readonly UsageStatisticsEvent[]
  readonly includesInstallNew: boolean
  readonly includesOnboarding: boolean
  readonly includesActive: boolean
}

/** Every event one completed day sends, in a stable order. Empty when there is nothing to say. */
export function buildUsageStatisticsDayReport(input: {
  readonly day: string
  readonly observations: UsageStatisticsDay
  readonly install: UsageStatisticsInstallState
}): UsageStatisticsDayReport {
  const { day, observations, install } = input
  const events: UsageStatisticsEvent[] = []
  const hasOwnEvents =
    observations.ranRun ||
    observations.appOpened > 0 ||
    observations.updates.length > 0 ||
    observations.events.length > 0
  const includesOnboarding = !install.onboardingReported && day === install.firstSeenDay
  const includesInstallNew = !install.newReported && (hasOwnEvents || includesOnboarding)
  if (includesInstallNew) events.push({ name: 'install.new', day, properties: {} })
  if (includesOnboarding) {
    events.push({ name: 'install.onboarding', day, properties: onboardingProperties(observations) })
  }
  if (observations.ranRun) {
    events.push({
      name: 'install.active',
      day,
      properties: installActiveProperties(day, observations, install),
    })
  }
  for (let opened = 0; opened < observations.appOpened; opened += 1) {
    events.push({ name: 'app.opened', day, properties: {} })
  }
  for (const previousVersion of observations.updates) {
    events.push({
      name: 'update.installed',
      day,
      properties: { previous_version: previousVersion },
    })
  }
  for (const event of observations.events) {
    events.push({ name: event.name, day, properties: event.properties })
  }
  return { events, includesInstallNew, includesOnboarding, includesActive: observations.ranRun }
}
