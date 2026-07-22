import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'

export type ContributionPillTone = 'neutral' | 'good' | 'warning' | 'error'

export function contributionPillToneClassName(tone: ContributionPillTone) {
  return match(tone)
    .with('good', () => 'bg-emerald-500/10 text-emerald-300')
    .with('warning', () => 'bg-amber-500/10 text-amber-300')
    .with('error', () => 'bg-error/10 text-error')
    .with('neutral', () => 'bg-bg-tertiary text-text-tertiary')
    .exhaustive()
}

export function eligibilityPills(entry: ExtensionContributionRegistryEntry) {
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

export function settingsContributionEntries(
  registry: ExtensionContributionRegistryView | null,
): readonly ExtensionContributionRegistryEntry[] {
  if (!registry) {
    return []
  }

  return registry.entries.filter(
    (entry) => entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  )
}

export function contributionKey(entry: ExtensionContributionRegistryEntry) {
  return `${entry.packagePath}:${entry.contributionId}`
}
