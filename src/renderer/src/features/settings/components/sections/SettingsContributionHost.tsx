import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { SettingsContributionSlot } from './SettingsContributionSlot'
import { SettingsContributionSlotBoundary } from './SettingsContributionSlotBoundary'
import { contributionKey, settingsContributionEntries } from './settings-contribution-host-model'

export { SettingsContributionSlot } from './SettingsContributionSlot'
export { SettingsContributionSlotBoundary } from './SettingsContributionSlotBoundary'

export function SettingsContributionHost({
  registry,
}: {
  readonly registry: ExtensionContributionRegistryView | null
}) {
  const entries = settingsContributionEntries(registry)

  if (entries.length === 0) {
    return null
  }

  return (
    <section aria-label="Extension settings contributions" className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-text-secondary">Extension settings</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {entries.length} settings section{entries.length === 1 ? '' : 's'} from enabled
          extensions.
        </p>
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <SettingsContributionSlotBoundary key={contributionKey(entry)} entry={entry}>
            <SettingsContributionSlot entry={entry} />
          </SettingsContributionSlotBoundary>
        ))}
      </div>
    </section>
  )
}
