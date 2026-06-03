import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionUiLane,
} from '@shared/types/extensions'
import { Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { ExtensionDiagnostics } from './ExtensionDiagnostics'

type ContributionPillTone = 'neutral' | 'good' | 'warning' | 'error'

const GOOD_TONE: ContributionPillTone = 'good'
const WARNING_TONE: ContributionPillTone = 'warning'

function contributionPillToneClassName(tone: ContributionPillTone) {
  return match(tone)
    .with('good', () => 'bg-emerald-500/10 text-emerald-300')
    .with('warning', () => 'bg-amber-500/10 text-amber-300')
    .with('error', () => 'bg-error/10 text-error')
    .with('neutral', () => 'bg-bg-tertiary text-text-tertiary')
    .exhaustive()
}

function ContributionPill({
  children,
  tone,
}: {
  readonly children: string
  readonly tone: ContributionPillTone
}) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        contributionPillToneClassName(tone),
      )}
    >
      {children}
    </span>
  )
}

function laneLabel(lane: ExtensionContributionUiLane | undefined) {
  if (!lane) {
    return 'No lane'
  }

  return match(lane)
    .with('declarative', () => 'Declarative')
    .with('webview', () => 'Webview')
    .with('trusted-react', () => 'Trusted React')
    .exhaustive()
}

function laneTone(lane: ExtensionContributionUiLane | undefined): ContributionPillTone {
  if (!lane) {
    return 'error'
  }

  return match(lane)
    .with('declarative', () => GOOD_TONE)
    .with('webview', 'trusted-react', () => WARNING_TONE)
    .exhaustive()
}

function eligibilityPills(entry: ExtensionContributionRegistryEntry) {
  const pills: { readonly label: string; readonly tone: ContributionPillTone }[] = []
  const eligibility = entry.eligibility

  if (!eligibility.runtimeEnabled) {
    pills.push({ label: 'Runtime disabled', tone: 'error' })
  }
  if (!eligibility.enabled) {
    pills.push({ label: 'Disabled', tone: 'neutral' })
  }
  if (!eligibility.trusted) {
    pills.push({ label: 'Untrusted', tone: 'warning' })
  }
  if (eligibility.sdkCompatible === false) {
    pills.push({ label: 'SDK blocked', tone: 'error' })
  }
  if (eligibility.updateAvailable) {
    pills.push({ label: 'Update pending', tone: 'warning' })
  }
  if (eligibility.disabledProjectPaths.length > 0) {
    const disabledCount = eligibility.disabledProjectPaths.length
    pills.push({
      label: `${disabledCount} project opt-out${disabledCount === 1 ? '' : 's'}`,
      tone: 'warning',
    })
  }

  return pills
}

function settingsContributionEntries(
  registry: ExtensionContributionRegistryView | null,
): readonly ExtensionContributionRegistryEntry[] {
  if (!registry) {
    return []
  }

  return registry.entries.filter(
    (entry) => entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  )
}

function contributionKey(entry: ExtensionContributionRegistryEntry) {
  return `${entry.packagePath}:${entry.contributionId}`
}

function projectCoverageLabel(entry: ExtensionContributionRegistryEntry) {
  if (entry.projectPaths.length === 0) {
    return 'No eligible projects'
  }

  const projectCount = entry.projectPaths.length
  const projectLabel = `${projectCount} project${projectCount === 1 ? '' : 's'}`
  return entry.appliesToAllRequestedProjects ? projectLabel : `${projectLabel} eligible`
}

function ContributionFact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="truncate text-[12px] text-text-secondary">{children}</div>
    </div>
  )
}

function SettingsContributionNativeBody({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  if (entry.lane === 'declarative') {
    return (
      <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
        <div className="text-[12px] font-medium text-accent">Native settings host</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ContributionFact label="Entry">
            {entry.entryPath ?? 'No entry declared'}
          </ContributionFact>
          <ContributionFact label="Capability">
            {entry.capability ?? 'No capability'}
          </ContributionFact>
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

export function SettingsContributionSlotBoundary({
  entry,
  children,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly children: ReactNode
}) {
  return (
    <PanelErrorBoundary name={`Extension settings: ${entry.title}`}>{children}</PanelErrorBoundary>
  )
}

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
            <ContributionPill tone={laneTone(entry.lane)}>{laneLabel(entry.lane)}</ContributionPill>
            <ContributionPill tone="neutral">{entry.scope.label}</ContributionPill>
            {extraPills.map((pill) => (
              <ContributionPill key={pill.label} tone={pill.tone}>
                {pill.label}
              </ContributionPill>
            ))}
          </div>
          <div className="mt-1 truncate text-[12px] text-text-muted">{entry.extensionName}</div>
        </div>
      </div>
      <div className="mt-4">
        <SettingsContributionNativeBody entry={entry} />
      </div>
      <div className="mt-3 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2">
        <ContributionFact label="Contribution ID">{entry.contributionId}</ContributionFact>
        <ContributionFact label="Projects">{projectCoverageLabel(entry)}</ContributionFact>
        <ContributionFact label="Package">{entry.packagePath}</ContributionFact>
        <ContributionFact label="Manifest">{entry.manifestPath}</ContributionFact>
      </div>
      <ExtensionDiagnostics diagnostics={entry.diagnostics} />
    </article>
  )
}

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
