/**
 * What one process observed about this Install during one UTC day (ADR 0044). Everything here is
 * already reduced to published values: catalog identifiers or `custom`, enum values, buckets and
 * bounded counts. Nothing names a project, path, Session or person.
 */
import { matchBy } from '@diegogbrisa/ts-match'
import {
  type USAGE_STATISTICS_ACCESS_MODES,
  type USAGE_STATISTICS_COMPACTION_MECHANISMS,
  USAGE_STATISTICS_CUSTOM_IDENTIFIER,
  type USAGE_STATISTICS_ENTRY_POINTS,
  USAGE_STATISTICS_EVENT_FIELDS,
  USAGE_STATISTICS_FEATURE_FLAGS,
  USAGE_STATISTICS_MAX_EVENT_AGE_DAYS,
  USAGE_STATISTICS_MAX_LIST_ITEMS,
  type USAGE_STATISTICS_RUN_RESULTS,
  type USAGE_STATISTICS_THINKING_LEVELS,
  type UsageStatisticsFeatureFlag,
} from '@shared/usage-statistics/contract'
import {
  usageStatisticsEpochDay,
  usageStatisticsFieldError,
} from '@shared/usage-statistics/validation'

export type UsageStatisticsEntryPoint = (typeof USAGE_STATISTICS_ENTRY_POINTS)[number]
export type UsageStatisticsThinkingLevel = (typeof USAGE_STATISTICS_THINKING_LEVELS)[number]
export type UsageStatisticsAccessMode = (typeof USAGE_STATISTICS_ACCESS_MODES)[number]
export type UsageStatisticsRunResult = (typeof USAGE_STATISTICS_RUN_RESULTS)[number]
export type UsageStatisticsCompactionMechanism =
  (typeof USAGE_STATISTICS_COMPACTION_MECHANISMS)[number]

/** Properties of one `run.finished` event, exactly as the contract publishes them. */
export type UsageStatisticsRunFinishedProperties = {
  readonly entry_point: UsageStatisticsEntryPoint
  readonly provider: string
  readonly model: string
  readonly thinking_level: UsageStatisticsThinkingLevel
  readonly access_mode: UsageStatisticsAccessMode
  readonly waggle: boolean
  readonly result: UsageStatisticsRunResult
  readonly duration_s: number
  readonly input_tokens: number
  readonly output_tokens: number
}

export type UsageStatisticsQueuedEvent =
  | { readonly name: 'run.finished'; readonly properties: UsageStatisticsRunFinishedProperties }
  | {
      readonly name: 'run.compacted'
      readonly properties: { readonly mechanism: UsageStatisticsCompactionMechanism }
    }

export interface UsageStatisticsDay {
  /** At least one Run started; this alone makes the day an Active install day. */
  readonly ranRun: boolean
  readonly entryPoints: readonly UsageStatisticsEntryPoint[]
  readonly features: readonly UsageStatisticsFeatureFlag[]
  readonly mcpServers: readonly string[]
  readonly skills: readonly string[]
  /** Largest number of enabled extensions seen on the day; `null` until one Run reported it. */
  readonly extensionsEnabled: number | null
  readonly appOpened: number
  /** `previous_version` of each `update.installed`. */
  readonly updates: readonly string[]
  readonly events: readonly UsageStatisticsQueuedEvent[]
  /** Onboarding steps, only reported for the Install's first day. */
  readonly providerConnected: boolean
  readonly projectOpened: boolean
}

export type UsageStatisticsObservation =
  | { readonly kind: 'run-started'; readonly entryPoint: UsageStatisticsEntryPoint }
  | { readonly kind: 'feature'; readonly flag: UsageStatisticsFeatureFlag }
  | { readonly kind: 'mcp-server'; readonly identifier: string }
  | { readonly kind: 'skill'; readonly identifier: string }
  | { readonly kind: 'extensions-enabled'; readonly count: number }
  | { readonly kind: 'app-opened' }
  | { readonly kind: 'update-installed'; readonly previousVersion: string }
  | { readonly kind: 'run-finished'; readonly properties: UsageStatisticsRunFinishedProperties }
  | { readonly kind: 'run-compacted'; readonly mechanism: UsageStatisticsCompactionMechanism }
  | { readonly kind: 'provider-connected' }
  | { readonly kind: 'project-opened' }

/**
 * Per-day bounds. One completed day is one request of at most 200 events: one each of
 * `install.active`, `install.new` and `install.onboarding`, plus these caps.
 */
export const USAGE_STATISTICS_DAY_LIMITS = {
  appOpened: 20,
  updates: 5,
  runEvents: 150,
  listItems: USAGE_STATISTICS_MAX_LIST_ITEMS,
} as const

/** Days kept locally: the endpoint's accepted window plus today. */
export const USAGE_STATISTICS_RETAINED_DAYS = USAGE_STATISTICS_MAX_EVENT_AGE_DAYS + 1

export const EMPTY_USAGE_STATISTICS_DAY: UsageStatisticsDay = {
  ranRun: false,
  entryPoints: [],
  features: [],
  mcpServers: [],
  skills: [],
  extensionsEnabled: null,
  appOpened: 0,
  updates: [],
  events: [],
  providerConnected: false,
  projectOpened: false,
}

const IDENTIFIER_SPEC = { kind: 'identifier' } as const
const VERSION_SPEC = { kind: 'version' } as const

/** A catalog identifier the endpoint accepts, otherwise `custom`. */
export function usageStatisticsIdentifierOrCustom(value: string) {
  return usageStatisticsFieldError(IDENTIFIER_SPEC, value) === undefined
    ? value
    : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}

export function isUsageStatisticsVersion(value: string) {
  return usageStatisticsFieldError(VERSION_SPEC, value) === undefined
}

export function isUsageStatisticsFeatureFlag(value: string): value is UsageStatisticsFeatureFlag {
  return USAGE_STATISTICS_FEATURE_FLAGS.some((flag) => flag === value)
}

function withItem<T extends string>(items: readonly T[], item: T, limit: number) {
  if (items.includes(item) || items.length >= limit) return items
  return [...items, item]
}

function runFinishedPropertiesAreValid(properties: UsageStatisticsRunFinishedProperties) {
  const specs: Readonly<Record<string, Parameters<typeof usageStatisticsFieldError>[0]>> =
    USAGE_STATISTICS_EVENT_FIELDS['run.finished']
  return Object.entries(properties).every(([field, value]) => {
    const spec = specs[field]
    return spec !== undefined && usageStatisticsFieldError(spec, value) === undefined
  })
}

function withEvent(day: UsageStatisticsDay, event: UsageStatisticsQueuedEvent): UsageStatisticsDay {
  if (day.events.length >= USAGE_STATISTICS_DAY_LIMITS.runEvents) return day
  return { ...day, events: [...day.events, event] }
}

function withListItem(
  day: UsageStatisticsDay,
  list: 'mcpServers' | 'skills',
  identifier: string,
): UsageStatisticsDay {
  const item = usageStatisticsIdentifierOrCustom(identifier)
  return { ...day, [list]: withItem(day[list], item, USAGE_STATISTICS_DAY_LIMITS.listItems) }
}

function withExtensionsEnabled(day: UsageStatisticsDay, count: number): UsageStatisticsDay {
  if (!Number.isSafeInteger(count) || count < 0) return day
  return { ...day, extensionsEnabled: Math.max(day.extensionsEnabled ?? 0, count) }
}

function withUpdate(day: UsageStatisticsDay, previousVersion: string): UsageStatisticsDay {
  if (!isUsageStatisticsVersion(previousVersion)) return day
  if (day.updates.length >= USAGE_STATISTICS_DAY_LIMITS.updates) return day
  return { ...day, updates: [...day.updates, previousVersion] }
}

/** Applies one observation to a day. Invalid or over-limit observations leave it unchanged. */
export function applyUsageStatisticsObservation(
  day: UsageStatisticsDay,
  observation: UsageStatisticsObservation,
): UsageStatisticsDay {
  const unlimited = Number.POSITIVE_INFINITY
  return matchBy(observation, 'kind')
    .with('run-started', ({ entryPoint }) => ({
      ...day,
      ranRun: true,
      entryPoints: withItem(day.entryPoints, entryPoint, unlimited),
    }))
    .with('feature', ({ flag }) => ({ ...day, features: withItem(day.features, flag, unlimited) }))
    .with('mcp-server', ({ identifier }) => withListItem(day, 'mcpServers', identifier))
    .with('skill', ({ identifier }) => withListItem(day, 'skills', identifier))
    .with('extensions-enabled', ({ count }) => withExtensionsEnabled(day, count))
    .with('app-opened', () => ({
      ...day,
      appOpened: Math.min(day.appOpened + 1, USAGE_STATISTICS_DAY_LIMITS.appOpened),
    }))
    .with('update-installed', ({ previousVersion }) => withUpdate(day, previousVersion))
    .with('run-finished', ({ properties }) =>
      runFinishedPropertiesAreValid(properties)
        ? withEvent(day, { name: 'run.finished', properties })
        : day,
    )
    .with('run-compacted', ({ mechanism }) =>
      withEvent(day, { name: 'run.compacted', properties: { mechanism } }),
    )
    .with('provider-connected', () => ({ ...day, providerConnected: true }))
    .with('project-opened', () => ({ ...day, projectOpened: true }))
    .exhaustive()
}

function union<T extends string>(left: readonly T[], right: readonly T[], limit: number) {
  return right.reduce((items, item) => withItem(items, item, limit), left)
}

/** Combines what the GUI and the Session Host observed for the same day. */
export function mergeUsageStatisticsDays(
  left: UsageStatisticsDay,
  right: UsageStatisticsDay,
): UsageStatisticsDay {
  const unlimited = Number.POSITIVE_INFINITY
  const extensionsEnabled =
    left.extensionsEnabled === null && right.extensionsEnabled === null
      ? null
      : Math.max(left.extensionsEnabled ?? 0, right.extensionsEnabled ?? 0)
  return {
    ranRun: left.ranRun || right.ranRun,
    entryPoints: union(left.entryPoints, right.entryPoints, unlimited),
    features: union(left.features, right.features, unlimited),
    mcpServers: union(left.mcpServers, right.mcpServers, USAGE_STATISTICS_DAY_LIMITS.listItems),
    skills: union(left.skills, right.skills, USAGE_STATISTICS_DAY_LIMITS.listItems),
    extensionsEnabled,
    appOpened: Math.min(left.appOpened + right.appOpened, USAGE_STATISTICS_DAY_LIMITS.appOpened),
    updates: [...left.updates, ...right.updates].slice(0, USAGE_STATISTICS_DAY_LIMITS.updates),
    events: [...left.events, ...right.events].slice(0, USAGE_STATISTICS_DAY_LIMITS.runEvents),
    providerConnected: left.providerConnected || right.providerConnected,
    projectOpened: left.projectOpened || right.projectOpened,
  }
}

function sameDay(left: UsageStatisticsDay, right: UsageStatisticsDay) {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Records one observation under `day`, dropping days that can no longer be reported. Returns
 * `days` itself when nothing changed, so the caller can skip rewriting its file.
 */
export function recordUsageStatisticsObservation(
  days: Readonly<Record<string, UsageStatisticsDay>>,
  day: string,
  observation: UsageStatisticsObservation,
): Readonly<Record<string, UsageStatisticsDay>> {
  const before = days[day] ?? EMPTY_USAGE_STATISTICS_DAY
  const after = applyUsageStatisticsObservation(before, observation)
  const recorded = sameDay(before, after) ? days : { ...days, [day]: after }
  return pruneUsageStatisticsDays(recorded, day)
}

/**
 * Keeps only valid days inside the retained window ending at `today`. Days after `today` are
 * dropped too: they were recorded while the clock was ahead and must not be reported later.
 * Returns `days` itself when nothing was dropped.
 */
export function pruneUsageStatisticsDays(
  days: Readonly<Record<string, UsageStatisticsDay>>,
  today: string,
): Readonly<Record<string, UsageStatisticsDay>> {
  const todayEpochDay = usageStatisticsEpochDay(today)
  if (todayEpochDay === undefined) return days
  const kept: Record<string, UsageStatisticsDay> = {}
  let dropped = false
  for (const [day, observations] of Object.entries(days)) {
    const epochDay = usageStatisticsEpochDay(day)
    if (
      epochDay === undefined ||
      epochDay <= todayEpochDay - USAGE_STATISTICS_RETAINED_DAYS ||
      epochDay > todayEpochDay
    ) {
      dropped = true
      continue
    }
    kept[day] = observations
  }
  return dropped ? kept : days
}
