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
    readonly DO_NOT_TRACK?: string | undefined
    readonly PI_TELEMETRY?: string | undefined
    readonly CI?: string | undefined
    readonly OPENWAGGLE_AUTOMATION?: string | undefined
  }
}

export type UsageStatisticsDisabledReason =
  | 'setting'
  | 'dev-build'
  | 'do-not-track'
  | 'pi-telemetry'
  | 'ci'
  | 'automation'

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
export function resolveUsageStatisticsEnablement(
  input: UsageStatisticsEnablementInput,
): UsageStatisticsEnablement {
  if (input.buildChannel === 'dev') return { enabled: false, reason: 'dev-build' }
  if (input.env.OPENWAGGLE_AUTOMATION === '1') return { enabled: false, reason: 'automation' }
  if (isSet(input.env.DO_NOT_TRACK)) return { enabled: false, reason: 'do-not-track' }
  if (!piTelemetryAllows(input.env.PI_TELEMETRY)) return { enabled: false, reason: 'pi-telemetry' }
  if (isSet(input.env.CI)) return { enabled: false, reason: 'ci' }
  if (!input.settingEnabled) return { enabled: false, reason: 'setting' }
  return { enabled: true }
}
