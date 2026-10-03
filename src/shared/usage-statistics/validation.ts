/**
 * Validation for the Usage statistics wire contract in ./contract.ts. Shared by the app's
 * tests and the statistics endpoint, so it stays dependency-free and alias-free.
 */
import {
  USAGE_STATISTICS_ARCHITECTURES,
  USAGE_STATISTICS_BUILD_CHANNELS,
  USAGE_STATISTICS_CONTEXT_FIELDS,
  USAGE_STATISTICS_EVENT_FIELDS,
  USAGE_STATISTICS_MAX_EVENT_AGE_DAYS,
  USAGE_STATISTICS_MAX_IDENTIFIER_LENGTH,
  USAGE_STATISTICS_MAX_LIST_ITEMS,
  USAGE_STATISTICS_MAX_VERSION_LENGTH,
  USAGE_STATISTICS_OPERATING_SYSTEMS,
  USAGE_STATISTICS_OPTIONAL_INSTALL_ACTIVE_FIELDS,
  USAGE_STATISTICS_UPDATE_CHANNELS,
  type UsageStatisticsContext,
  type UsageStatisticsEvent,
  type UsageStatisticsEventName,
  type UsageStatisticsFieldSpec,
  type UsageStatisticsValue,
} from './contract'

export type UsageStatisticsValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly field: string; readonly reason: string }

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:/@-]*$/iu
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u
const MS_PER_DAY = 86_400_000
const ISO_DAY_LENGTH = 10
const ALLOWED_CLOCK_SKEW_DAYS = 1
const EVENT_KEYS: ReadonlySet<string> = new Set(['name', 'day', 'properties'])

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= USAGE_STATISTICS_MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(value)
  )
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= USAGE_STATISTICS_MAX_LIST_ITEMS &&
    value.every((item) => typeof item === 'string') &&
    new Set(value).size === value.length
  )
}

function isVersion(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length <= USAGE_STATISTICS_MAX_VERSION_LENGTH &&
    VERSION_PATTERN.test(value)
  )
}

function includes<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}

type FieldCheck = (spec: UsageStatisticsFieldSpec, value: unknown) => string | undefined

function allowedValues(spec: UsageStatisticsFieldSpec): readonly string[] {
  return 'values' in spec ? spec.values : []
}

function integerInRange(spec: UsageStatisticsFieldSpec, value: unknown) {
  if (spec.kind !== 'integer') return false
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= spec.min &&
    value <= spec.max
  )
}

const FIELD_CHECKS: Readonly<Record<UsageStatisticsFieldSpec['kind'], FieldCheck>> = {
  boolean: (_spec, value) => (typeof value === 'boolean' ? undefined : 'expected a boolean'),
  enum: (spec, value) =>
    includes(allowedValues(spec), value) ? undefined : 'value is not in the published list',
  'enum-list': (spec, value) => {
    const allowed = new Set(allowedValues(spec))
    return isStringList(value) && value.every((item) => allowed.has(item))
      ? undefined
      : 'list contains a value outside the published list'
  },
  identifier: (_spec, value) => (isIdentifier(value) ? undefined : 'expected a catalog identifier'),
  'identifier-list': (_spec, value) =>
    isStringList(value) && value.every(isIdentifier)
      ? undefined
      : 'expected a list of catalog identifiers',
  integer: (spec, value) =>
    integerInRange(spec, value) ? undefined : 'integer is outside the allowed range',
  version: (_spec, value) => (isVersion(value) ? undefined : 'expected a version'),
}

/** Returns a reason when `value` does not satisfy `spec`, otherwise `undefined`. */
export function usageStatisticsFieldError(spec: UsageStatisticsFieldSpec, value: unknown) {
  return FIELD_CHECKS[spec.kind](spec, value)
}

function isEventName(value: unknown): value is UsageStatisticsEventName {
  return typeof value === 'string' && Object.hasOwn(USAGE_STATISTICS_EVENT_FIELDS, value)
}

function fieldsOf(
  name: UsageStatisticsEventName,
): Readonly<Record<string, UsageStatisticsFieldSpec>> {
  return USAGE_STATISTICS_EVENT_FIELDS[name]
}

function isFieldOptional(name: UsageStatisticsEventName, field: string) {
  return name === 'install.active' && USAGE_STATISTICS_OPTIONAL_INSTALL_ACTIVE_FIELDS.has(field)
}

function failure(field: string, reason: string) {
  return { ok: false, field, reason } as const
}

function firstUnknownKey(
  value: Readonly<Record<string, unknown>>,
  allowed: (key: string) => boolean,
) {
  return Object.keys(value).find((key) => !allowed(key))
}

/** Validates request context. Unknown and missing fields are both rejected. */
export function validateUsageStatisticsContext(
  value: unknown,
): UsageStatisticsValidation<UsageStatisticsContext> {
  if (!isPlainObject(value)) return failure('context', 'expected an object')
  const specs: Readonly<Record<string, UsageStatisticsFieldSpec>> = USAGE_STATISTICS_CONTEXT_FIELDS
  const unknownKey = firstUnknownKey(value, (key) => Object.hasOwn(specs, key))
  if (unknownKey !== undefined) return failure(unknownKey, 'unknown field')
  const { version, build_channel, update_channel, os, arch } = value
  if (!isVersion(version) || typeof version !== 'string')
    return failure('version', 'expected a version')
  if (!includes(USAGE_STATISTICS_BUILD_CHANNELS, build_channel)) {
    return failure('build_channel', 'value is not in the published list')
  }
  if (!includes(USAGE_STATISTICS_UPDATE_CHANNELS, update_channel)) {
    return failure('update_channel', 'value is not in the published list')
  }
  if (!includes(USAGE_STATISTICS_OPERATING_SYSTEMS, os)) {
    return failure('os', 'value is not in the published list')
  }
  if (!includes(USAGE_STATISTICS_ARCHITECTURES, arch)) {
    return failure('arch', 'value is not in the published list')
  }
  return { ok: true, value: { version, build_channel, update_channel, os, arch } }
}

/** Converts a `YYYY-MM-DD` UTC day to its epoch day number, or `undefined` when invalid. */
export function usageStatisticsEpochDay(day: string): number | undefined {
  if (!DAY_PATTERN.test(day)) return undefined
  const time = Date.parse(`${day}T00:00:00.000Z`)
  if (Number.isNaN(time)) return undefined
  // Date.parse normalizes impossible dates such as 2026-02-31; reject those.
  return new Date(time).toISOString().startsWith(day) ? time / MS_PER_DAY : undefined
}

/** Formats a time as its UTC `YYYY-MM-DD` day. */
export function usageStatisticsDay(time: number | Date): string {
  return new Date(time).toISOString().slice(0, ISO_DAY_LENGTH)
}

function dayError(day: unknown, todayEpochDay: number) {
  const epochDay = typeof day === 'string' ? usageStatisticsEpochDay(day) : undefined
  if (epochDay === undefined) return 'expected a YYYY-MM-DD day'
  const tooNew = epochDay > todayEpochDay + ALLOWED_CLOCK_SKEW_DAYS
  const tooOld = epochDay < todayEpochDay - USAGE_STATISTICS_MAX_EVENT_AGE_DAYS
  return tooNew || tooOld ? 'day is outside the accepted window' : undefined
}

function acceptedValue(raw: unknown): UsageStatisticsValue | undefined {
  if (typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') return raw
  return isStringList(raw) ? [...raw] : undefined
}

function validateProperties(
  name: UsageStatisticsEventName,
  properties: Readonly<Record<string, unknown>>,
): UsageStatisticsValidation<Readonly<Record<string, UsageStatisticsValue>>> {
  const specs = fieldsOf(name)
  const accepted: Record<string, UsageStatisticsValue> = {}
  for (const [key, raw] of Object.entries(properties)) {
    const spec = Object.hasOwn(specs, key) ? specs[key] : undefined
    if (!spec) return failure(key, 'unknown field')
    const error = usageStatisticsFieldError(spec, raw)
    const value = acceptedValue(raw)
    if (error || value === undefined) return failure(key, error ?? 'unsupported value')
    accepted[key] = value
  }
  const missing = Object.keys(specs).find(
    (key) => !Object.hasOwn(accepted, key) && !isFieldOptional(name, key),
  )
  if (missing !== undefined) return failure(missing, 'missing field')
  return { ok: true, value: accepted }
}

/**
 * Validates one event. `todayEpochDay` bounds the accepted day to the last
 * {@link USAGE_STATISTICS_MAX_EVENT_AGE_DAYS} days and allows one day ahead for clock skew.
 */
export function validateUsageStatisticsEvent(
  value: unknown,
  todayEpochDay: number,
): UsageStatisticsValidation<UsageStatisticsEvent> {
  if (!isPlainObject(value)) return failure('event', 'expected an object')
  const unknownKey = firstUnknownKey(value, (key) => EVENT_KEYS.has(key))
  if (unknownKey !== undefined) return failure(unknownKey, 'unknown field')
  const { name, day, properties } = value
  if (!isEventName(name)) return failure('name', 'unknown event')
  const invalidDay = dayError(day, todayEpochDay)
  if (invalidDay || typeof day !== 'string') return failure('day', invalidDay ?? 'expected a day')
  if (!isPlainObject(properties)) return failure('properties', 'expected an object')
  const accepted = validateProperties(name, properties)
  if (!accepted.ok) return accepted
  return { ok: true, value: { name, day, properties: accepted.value } }
}
