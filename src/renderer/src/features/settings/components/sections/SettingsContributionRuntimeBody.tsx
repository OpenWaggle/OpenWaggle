import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { ExtensionFederatedModuleHost } from '@/features/extensions'
import { SettingsContributionFact } from './SettingsContributionFact'

export function SettingsContributionRuntimeBody({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  return (
    <div className="space-y-3">
      <ExtensionFederatedModuleHost entry={entry} />
      <div className="grid gap-2 sm:grid-cols-2">
        <SettingsContributionFact label="Entry">
          {entry.entryPath ?? 'No entry declared'}
        </SettingsContributionFact>
        <SettingsContributionFact label="Capability">
          {entry.capability ?? 'No capability'}
        </SettingsContributionFact>
      </div>
    </div>
  )
}
