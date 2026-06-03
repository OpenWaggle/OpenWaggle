import type {
  ExtensionContributionFamily,
  ExtensionContributionRegistryView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import type {
  ExtensionContributionFamilyCount,
  PackageContributionSummary,
} from './extension-contribution-summary-model'
import { familyCountsFor } from './extension-contribution-summary-model'

const FAMILY_LABELS = {
  commands: 'Commands',
  slashCommands: 'Slash commands',
  routes: 'Routes',
  settingsSections: 'Settings',
  sidePanels: 'Side panels',
  dialogs: 'Dialogs',
  transcriptRenderers: 'Transcript',
  statusWidgets: 'Status',
} satisfies Record<ExtensionContributionFamily, string>

function positiveCounts(counts: readonly ExtensionContributionFamilyCount[]) {
  return counts.filter((entry) => entry.count > 0)
}

function declaredTotal(packages: readonly ExtensionPackageSummary[]) {
  return packages.reduce(
    (total, extensionPackage) => total + (extensionPackage.manifest?.contributionCount ?? 0),
    0,
  )
}

function contributionStats({
  registry,
  packages,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly packages: readonly ExtensionPackageSummary[]
}) {
  if (!registry) {
    return [{ label: 'Declared contributions', value: declaredTotal(packages) }]
  }

  const familyCounts = familyCountsFor(registry.entries)
  const packageKeys = new Set(registry.entries.map((entry) => entry.packagePath))

  return [
    { label: 'Registry contributions', value: registry.entries.length },
    { label: 'Families', value: positiveCounts(familyCounts).length },
    { label: 'Packages', value: packageKeys.size },
  ]
}

function ContributionStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-[#111418] px-3 py-2">
      <div className="text-[18px] font-semibold text-text-primary">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  )
}

export function ExtensionContributionSummary({
  registry,
  packages,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly packages: readonly ExtensionPackageSummary[]
}) {
  const stats = contributionStats({ registry, packages })

  return (
    <section
      aria-label="Extension contribution summary"
      className="grid gap-2 rounded-xl border border-border bg-bg-secondary/30 p-3 sm:grid-cols-3"
    >
      {stats.map((stat) => (
        <ContributionStat key={stat.label} label={stat.label} value={stat.value} />
      ))}
    </section>
  )
}

export function PackageContributionDetails({
  summary,
  fallbackCount,
}: {
  readonly summary: PackageContributionSummary | null
  readonly fallbackCount: number
}) {
  if (!summary) {
    return <>{fallbackCount}</>
  }

  const familyCounts = positiveCounts(summary.familyCounts)

  return (
    <div className="space-y-1">
      <div>{summary.totalCount}</div>
      {familyCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {familyCounts.map((entry) => (
            <span
              key={entry.family}
              className="rounded border border-border/70 bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary"
            >
              {FAMILY_LABELS[entry.family]} {entry.count}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[11px] text-text-muted">No families</span>
      )}
    </div>
  )
}
