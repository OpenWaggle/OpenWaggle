/**
 * Whether this process may send Usage statistics and error reports (ADR 0046).
 *
 * The decision combines the build channel and this process's environment, which never change
 * while it runs, with the persisted `usageStatisticsEnabled` Setting, which this module reads from
 * the settings store's authoritative snapshot (store/authoritative-settings.ts). The store is the
 * same module in the GUI main process and in the Session Host, so this works unchanged in both;
 * in an attached GUI only a snapshot hydrated from the Host counts (see store/settings.ts). Until there is one the Setting
 * is unknown, and an unknown Setting counts as off: a user who turned statistics off must never
 * send a report because it was read too early. The one exception is a process whose Settings
 * could not load at all, such as a GUI whose Session Host did not start: it may act on the value
 * the Session Host last saved, or the default on an install that never stored Settings
 * (usage-statistics-last-known-setting.ts).
 */
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import type { BuildChannel } from '@shared/types/build-identity'
import {
  resolveUsageStatisticsEnablement,
  resolveUsageStatisticsEnvironmentBlock,
  type UsageStatisticsEnablement,
  type UsageStatisticsEnablementInput,
  type UsageStatisticsEnvironmentBlock,
} from '@shared/usage-statistics/enablement'
import { usageStatisticsEnv } from '../usage-statistics-env'
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
  /** The build or environment opt-out, which no Setting overrides; null when there is none. */
  readonly environmentBlock: () => UsageStatisticsEnvironmentBlock | null
  readonly onChange: (listener: UsageStatisticsEnablementListener) => () => void
  /** The Setting from an authoritative snapshot; `undefined` means there is none yet. */
  readonly publishSetting: (settingEnabled: boolean | undefined) => void
  /**
   * The Setting to act on while there is no authoritative snapshot, for a process whose Settings
   * could not load (usage-statistics-last-known-setting.ts). A snapshot always wins over it.
   */
  readonly publishSettingWithoutSettings: (settingEnabled: boolean | undefined) => void
}

export function createUsageStatisticsEnablementState(input: {
  readonly buildChannel: BuildChannel
  readonly env: UsageStatisticsEnablementInput['env']
}) {
  let settingEnabled: boolean | undefined
  let settingWithoutSettings: boolean | undefined
  let settingsLoaded = false
  const listeners = new Set<UsageStatisticsEnablementListener>()

  // The build and environment never change while the process runs.
  const environmentBlock = () => resolveUsageStatisticsEnvironmentBlock(input)

  const current = () => {
    // A build or environment opt-out names its reason even before Settings load.
    const block = environmentBlock()
    if (block !== null) {
      return { enabled: false, reason: block } satisfies UsageStatisticsProcessEnablement
    }
    const setting = settingEnabled ?? settingWithoutSettings
    if (setting === undefined) {
      return {
        enabled: false,
        reason: 'settings-unavailable',
      } satisfies UsageStatisticsProcessEnablement
    }
    return resolveUsageStatisticsEnablement({
      settingEnabled: setting,
      buildChannel: input.buildChannel,
      env: input.env,
    }) satisfies UsageStatisticsProcessEnablement
  }

  const isEnabled = () => current().enabled

  return {
    isEnabled,
    current,
    environmentBlock,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publishSetting: (next) => {
      change(() => {
        settingEnabled = next
        // Once Settings loaded, the assumed value is gone for good: a snapshot that later
        // becomes unknown again counts as off, not as the value assumed before.
        if (next !== undefined) {
          settingsLoaded = true
          settingWithoutSettings = undefined
        }
      })
    },
    publishSettingWithoutSettings: (next) => {
      if (settingsLoaded) return
      change(() => {
        settingWithoutSettings = next
      })
    },
  } satisfies UsageStatisticsEnablementState

  function change(apply: () => void) {
    const before = isEnabled()
    apply()
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
  }
}

const processEnablement = createUsageStatisticsEnablementState({
  buildChannel: BUILD_CHANNEL,
  env: usageStatisticsEnv(),
})

onAuthoritativeSettingsChange((settings) =>
  processEnablement.publishSetting(settings?.usageStatisticsEnabled),
)

/**
 * Acts on `settingEnabled` until this process loads Settings, for a process whose Settings could
 * not load: the value from usage-statistics-last-known-setting.ts. Loaded Settings replace it.
 */
export function assumeUsageStatisticsSettingUntilSettingsLoad(settingEnabled: boolean | undefined) {
  processEnablement.publishSettingWithoutSettings(settingEnabled)
}

/** True only when this process may send Usage statistics and error reports right now. */
export function isUsageStatisticsEnabled() {
  return processEnablement.isEnabled()
}

/** The current decision with the reason it is off, for diagnostics. */
export function currentUsageStatisticsEnablement() {
  return processEnablement.current() satisfies UsageStatisticsProcessEnablement
}

/**
 * Calls `listener` with the new value each time {@link isUsageStatisticsEnabled} changes, which
 * happens only when the Setting changes or Settings first load. Returns the unsubscribe function.
 */
export function onUsageStatisticsEnablementChange(listener: UsageStatisticsEnablementListener) {
  return processEnablement.onChange(listener)
}
