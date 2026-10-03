import { USAGE_STATISTICS_DOCS_URL } from '@shared/constants/usage-statistics'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const logger = createRendererLogger('settings/usage-statistics')
const LABEL = 'Share anonymous usage statistics and error reports'

export function UsageStatisticsSetting() {
  const enabled = usePreferencesStore((state) => state.settings.usageStatisticsEnabled)
  const setUsageStatisticsEnabled = usePreferencesStore((state) => state.setUsageStatisticsEnabled)
  const [saving, setSaving] = useState(false)

  const change = (next: boolean) => {
    if (saving) return
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
      </div>
      <ToggleSwitch checked={enabled} onCheckedChange={change} label={LABEL} disabled={saving} />
    </div>
  )
}
