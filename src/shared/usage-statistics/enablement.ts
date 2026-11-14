/**
 * The single rule deciding whether this process may send Usage statistics and error reports
 * (ADR 0046). Statistics are on by default; any one of these turns them off.
 */
import type { BuildChannel } from '../types/build-identity'

export interface UsageStatisticsEnablementInput {
  /** The persisted Settings switch; `true` unless the user turned it off. */
  readonly settingEnabled: boolean
  readonly buildChannel: BuildChannel
  /** Raw environment values of the deciding process. */
  readonly env: {
    readonly DO_NOT_TRACK?: string
    readonly PI_TELEMETRY?: string
    readonly CI?: string
    readonly OPENWAGGLE_AUTOMATION?: string
  }
}

export type UsageStatisticsDisabledReason =
  | 'setting'
  | 'dev-build'
  | 'do-not-track'
  | 'pi-telemetry'
  | 'ci'
  | 'automation'

/** A reason that holds whatever the Settings switch says: the build or the environment. */
export type UsageStatisticsEnvironmentBlock = Exclude<UsageStatisticsDisabledReason, 'setting'>

export type UsageStatisticsEnablement =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: UsageStatisticsDisabledReason }

const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off'])

function isSet(value: string | undefined) {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && !FALSE_VALUES.has(normalized)
}

/** Pi's own rule (pi-coding-agent telemetry.js): once set, only 1, true or yes is on. */
function piTelemetryAllows(value: string | undefined) {
  if (value === undefined) return true
  const normalized = value.toLowerCase()
  return value === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * `DO_NOT_TRACK` follows the Console Do Not Track convention: any value other than empty or a
 * false word opts out. `PI_TELEMETRY` follows Pi: once set, anything other than 1, true or yes opts out.
 * `CI` is set by every common CI provider.
 */
export function resolveUsageStatisticsEnablement(input: UsageStatisticsEnablementInput) {
  if (input.buildChannel === 'dev') {
    return { enabled: false, reason: 'dev-build' } satisfies UsageStatisticsEnablement
  }
  if (input.env.OPENWAGGLE_AUTOMATION === '1') {
    return { enabled: false, reason: 'automation' } satisfies UsageStatisticsEnablement
  }
  if (isSet(input.env.DO_NOT_TRACK)) {
    return { enabled: false, reason: 'do-not-track' } satisfies UsageStatisticsEnablement
  }
  if (!piTelemetryAllows(input.env.PI_TELEMETRY)) {
    return { enabled: false, reason: 'pi-telemetry' } satisfies UsageStatisticsEnablement
  }
  if (isSet(input.env.CI)) {
    return { enabled: false, reason: 'ci' } satisfies UsageStatisticsEnablement
  }
  if (!input.settingEnabled) {
    return { enabled: false, reason: 'setting' } satisfies UsageStatisticsEnablement
  }
  return { enabled: true } satisfies UsageStatisticsEnablement
}

/**
 * Why this build or environment sends nothing whatever the Setting says, or null when the Setting
 * decides. The Settings switch shows it off and disabled with this reason (#356).
 */
export function resolveUsageStatisticsEnvironmentBlock(
  input: Omit<UsageStatisticsEnablementInput, 'settingEnabled'>,
) {
  const resolved = resolveUsageStatisticsEnablement({ ...input, settingEnabled: true })
  if (resolved.enabled || resolved.reason === 'setting') return null
  return resolved.reason
}
