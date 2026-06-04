import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { SettingsContributionFact } from './SettingsContributionFact'

export function SettingsContributionNativeBody({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  if (entry.lane === 'declarative') {
    return (
      <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
        <div className="text-[12px] font-medium text-accent">Native settings host</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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

  return (
    <div className="rounded-md border border-border/70 bg-bg-secondary/40 p-3 text-[12px] text-text-tertiary">
      Renderer lane not mounted here.
    </div>
  )
}
