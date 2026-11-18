/**
 * Connects this window's Settings to renderer error reporting (ADR 0045). The Usage statistics
 * Setting counts as on only once Settings loaded without an error and have it on, so a window
 * whose Settings are still loading, or failed to, never starts the SDK.
 */
import { usePreferencesStore } from '@/features/settings/state'
import {
  type RendererUsageStatistics,
  scheduleRendererErrorReporting,
} from '@/shared/lib/error-reporting'

export const windowUsageStatistics: RendererUsageStatistics = {
  isEnabled: () => {
    const { isLoaded, loadError, settings } = usePreferencesStore.getState()
    return isLoaded && loadError === null && settings.usageStatisticsEnabled
  },
  subscribe: (listener) => usePreferencesStore.subscribe(() => listener()),
}

/** Starts renderer error reporting once this window's Settings have Usage statistics on. */
export function startWindowErrorReporting() {
  scheduleRendererErrorReporting(windowUsageStatistics)
}
