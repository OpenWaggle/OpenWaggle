import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { Settings2 } from 'lucide-react'
import { ExtensionDiagnostics } from './ExtensionDiagnostics'
import { SettingsContributionPill } from './SettingsContributionPill'
import { SettingsContributionRuntimeBody } from './SettingsContributionRuntimeBody'
import { eligibilityPills } from './settings-contribution-host-model'

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
        <SettingsContributionRuntimeBody entry={entry} />
      </div>
      <ExtensionDiagnostics diagnostics={entry.diagnostics} />
    </article>
  )
}
