import { match } from '@diegogbrisa/ts-match'
import { USAGE_STATISTICS_DOCS_URL } from '@shared/constants/usage-statistics'
import type { UsageStatisticsEnvironmentBlock } from '@shared/usage-statistics/enablement'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const logger = createRendererLogger('settings/usage-statistics')
const LABEL = 'Share anonymous usage statistics and error reports'

/** Why the switch is off and locked; the saved choice applies again where none of these holds. */
function blockReason(block: UsageStatisticsEnvironmentBlock) {
  return match(block)
    .with(
      'dev-build',
      () => 'Off in development builds, which never send statistics or error reports.',
    )
    .with('automation', () => 'Off while OpenWaggle runs for automated testing.')
    .with(
      'do-not-track',
      () => 'Off because DO_NOT_TRACK is set in the environment OpenWaggle started with.',
    )
    .with(
      'pi-telemetry',
      () => 'Off because PI_TELEMETRY is off in the environment OpenWaggle started with.',
    )
    .with(
      'ci',
      () => 'Off because the CI variable is set in the environment OpenWaggle started with.',
    )
    .exhaustive()
}

/**
 * The build or environment opt-out of this process (#356). It never changes while the app runs,
 * so it is read once. Until it is known, the switch stays disabled rather than showing a Dev
 * build's statistics as on.
 */
const usageStatisticsBlockQuery = queryOptions({
  queryKey: queryKeys.usageStatisticsBlock,
  queryFn: () => api.getUsageStatisticsBlock(),
  staleTime: Number.POSITIVE_INFINITY,
})

export function UsageStatisticsSetting() {
  const enabled = usePreferencesStore((state) => state.settings.usageStatisticsEnabled)
  const setUsageStatisticsEnabled = usePreferencesStore((state) => state.setUsageStatisticsEnabled)
  const [saving, setSaving] = useState(false)
  const blockQuery = useQuery(usageStatisticsBlockQuery)
  const block = blockQuery.data ?? null
  // A failed read leaves the Setting in charge, as before; the main process still enforces it.
  const blockKnown = blockQuery.isSuccess || blockQuery.isError

  const change = (next: boolean) => {
    if (saving || block !== null) return
    setSaving(true)
    void setUsageStatisticsEnabled(next)
      .catch((error: unknown) => {
        logger.warn('Failed to update usage statistics', { error: String(error) })
      })
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">{LABEL}</span>
        <span className="text-xs text-text-tertiary">
          Anonymous counts of Runs and features used, never your code or anything that identifies
          you.{' '}
          <a
            href={USAGE_STATISTICS_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent transition-opacity hover:opacity-90"
          >
            What is sent
            <ExternalLink className="size-3" />
          </a>
        </span>
        {block !== null ? (
          <span className="text-xs text-text-secondary">{blockReason(block)}</span>
        ) : null}
      </div>
      <ToggleSwitch
        checked={enabled && block === null}
        onCheckedChange={change}
        label={LABEL}
        disabled={saving || block !== null || !blockKnown}
      />
    </div>
  )
}
