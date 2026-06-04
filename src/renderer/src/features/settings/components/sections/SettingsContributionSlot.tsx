import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { Settings2 } from 'lucide-react'
import { ExtensionDiagnostics } from './ExtensionDiagnostics'
import { SettingsContributionFact } from './SettingsContributionFact'
import { SettingsContributionNativeBody } from './SettingsContributionNativeBody'
import { SettingsContributionPill } from './SettingsContributionPill'
import {
  eligibilityPills,
  laneLabel,
  laneTone,
  projectCoverageLabel,
} from './settings-contribution-host-model'

export function SettingsContributionSlot({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  const extraPills = eligibilityPills(entry)

  return (
    <article className="rounded-lg border border-border bg-[#111418] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Settings2 className="size-4 text-accent" />
            <h3 className="text-[15px] font-semibold text-text-primary">{entry.title}</h3>
            <SettingsContributionPill tone={laneTone(entry.lane)}>
              {laneLabel(entry.lane)}
            </SettingsContributionPill>
            <SettingsContributionPill tone="neutral">{entry.scope.label}</SettingsContributionPill>
            {extraPills.map((pill) => (
              <SettingsContributionPill key={pill.label} tone={pill.tone}>
                {pill.label}
              </SettingsContributionPill>
            ))}
          </div>
          <div className="mt-1 truncate text-[12px] text-text-muted">{entry.extensionName}</div>
        </div>
      </div>
      <div className="mt-4">
        <SettingsContributionNativeBody entry={entry} />
      </div>
      <div className="mt-3 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2">
        <SettingsContributionFact label="Contribution ID">
          {entry.contributionId}
        </SettingsContributionFact>
        <SettingsContributionFact label="Projects">
          {projectCoverageLabel(entry)}
        </SettingsContributionFact>
        <SettingsContributionFact label="Package">{entry.packagePath}</SettingsContributionFact>
        <SettingsContributionFact label="Manifest">{entry.manifestPath}</SettingsContributionFact>
      </div>
      <ExtensionDiagnostics diagnostics={entry.diagnostics} />
    </article>
  )
}
