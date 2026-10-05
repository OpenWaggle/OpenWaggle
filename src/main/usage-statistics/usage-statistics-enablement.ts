/**
 * Whether this process may send Usage statistics and error reports (ADR 0046).
 *
 * The decision combines the build channel and this process's environment, which never change
 * while it runs, with the persisted `usageStatisticsEnabled` Setting, which this module reads from
 * the settings store's authoritative snapshot (store/authoritative-settings.ts). The store is the
 * same module in the GUI main process and in the Session Host, so this works unchanged in both;
 * in an attached GUI only a snapshot hydrated from the Host counts (see store/settings.ts). Until there is one the Setting
 * is unknown, and an unknown Setting counts as off: a user who turned statistics off must never
 * send a report because it was read too early.
 */
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import type { BuildChannel } from '@shared/types/build-identity'
import {
  resolveUsageStatisticsEnablement,
  type UsageStatisticsEnablement,
  type UsageStatisticsEnablementInput,
} from '@shared/usage-statistics/enablement'
import { env } from '../env'
import { createLogger } from '../logger'
import { onAuthoritativeSettingsChange } from '../store/authoritative-settings'

const logger = createLogger('usage-statistics')

/** The enablement plus the one state only a process can be in: Settings not loaded yet. */
export type UsageStatisticsProcessEnablement =
  | UsageStatisticsEnablement
  | { readonly enabled: false; readonly reason: 'settings-unavailable' }

export type UsageStatisticsEnablementListener = (enabled: boolean) => void

export interface UsageStatisticsEnablementState {
  readonly isEnabled: () => boolean
  readonly current: () => UsageStatisticsProcessEnablement
  readonly onChange: (listener: UsageStatisticsEnablementListener) => () => void
  /** The Setting from an authoritative snapshot; `undefined` means there is none yet. */
  readonly publishSetting: (settingEnabled: boolean | undefined) => void
}

export function createUsageStatisticsEnablementState(input: {
  readonly buildChannel: BuildChannel
  readonly env: UsageStatisticsEnablementInput['env']
}): UsageStatisticsEnablementState {
  let settingEnabled: boolean | undefined
  const listeners = new Set<UsageStatisticsEnablementListener>()

  const current = (): UsageStatisticsProcessEnablement => {
    // Evaluated with the Setting on first, so a build or environment opt-out names its reason
    // even before Settings load.
    const fixed = resolveUsageStatisticsEnablement({
      settingEnabled: true,
      buildChannel: input.buildChannel,
      env: input.env,
    })
    if (!fixed.enabled) return fixed
    if (settingEnabled === undefined) return { enabled: false, reason: 'settings-unavailable' }
    return resolveUsageStatisticsEnablement({
      settingEnabled,
      buildChannel: input.buildChannel,
      env: input.env,
    })
  }

  const isEnabled = () => current().enabled

  return {
    isEnabled,
    current,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publishSetting: (next) => {
      const before = isEnabled()
      settingEnabled = next
      const after = isEnabled()
      if (before === after) return
      for (const listener of [...listeners]) {
        try {
          listener(after)
        } catch (error) {
          logger.warn('A Usage statistics enablement listener failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
  }
}

const processEnablement = createUsageStatisticsEnablementState({
  buildChannel: BUILD_CHANNEL,
  env: {
    DO_NOT_TRACK: env.DO_NOT_TRACK,
    PI_TELEMETRY: env.PI_TELEMETRY,
    CI: env.CI,
    OPENWAGGLE_AUTOMATION: env.OPENWAGGLE_AUTOMATION,
  },
})

onAuthoritativeSettingsChange((settings) =>
  processEnablement.publishSetting(settings?.usageStatisticsEnabled),
)

/** True only when this process may send Usage statistics and error reports right now. */
export function isUsageStatisticsEnabled(): boolean {
  return processEnablement.isEnabled()
}

/** The current decision with the reason it is off, for diagnostics. */
export function currentUsageStatisticsEnablement(): UsageStatisticsProcessEnablement {
  return processEnablement.current()
}

/**
 * Calls `listener` with the new value each time {@link isUsageStatisticsEnabled} changes, which
 * happens only when the Setting changes or Settings first load. Returns the unsubscribe function.
 */
export function onUsageStatisticsEnablementChange(
  listener: UsageStatisticsEnablementListener,
): () => void {
  return processEnablement.onChange(listener)
}
