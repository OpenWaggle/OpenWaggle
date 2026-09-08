import { match, matchBy } from '@diegogbrisa/ts-match'
import type {
  BrowserImportFailureReason,
  BrowserImportSource,
  BrowserImportTarget,
  GuidedBrowserImportResult,
} from '@shared/types/browser-import'

const VISIBLE_SKIPPED_DOMAINS = 3

export interface WizardTargetProfile {
  readonly id: string
  readonly name: string
}

export type WizardTargetSelection =
  | { readonly kind: 'new' }
  | { readonly kind: 'existing'; readonly profileId: string }

export type BrowserImportWizardStep =
  | { readonly step: 'quit' }
  | {
      readonly step: 'full-disk-access'
      readonly resume: 'configure' | 'import'
      readonly checked?: boolean
    }
  | { readonly step: 'configure' }
  | {
      readonly step: 'checking'
      readonly check: 'browser' | 'full-disk-access'
    }
  | { readonly step: 'importing' }
  | {
      readonly step: 'done'
      readonly imported: number
      readonly skipped: number
      readonly skippedDomains: readonly string[]
      readonly targetName: string
      readonly createdProfile: boolean
    }
  | { readonly step: 'blocked'; readonly reason: BrowserImportFailureReason }

export function initialTargetSelection(
  canCreateProfile: boolean,
  targetProfiles: readonly WizardTargetProfile[],
): WizardTargetSelection {
  if (canCreateProfile) return { kind: 'new' }
  const first = targetProfiles[0]
  return first ? { kind: 'existing', profileId: first.id } : { kind: 'new' }
}

export function resolveWizardTarget(
  selection: WizardTargetSelection,
  newProfileId: string,
  targetProfiles: readonly WizardTargetProfile[],
): BrowserImportTarget | undefined {
  return matchBy(selection, 'kind')
    .with('new', () => ({ kind: 'new', profileId: newProfileId }))
    .with('existing', ({ profileId }) =>
      targetProfiles.some((profile) => profile.id === profileId)
        ? { kind: 'existing', profileId }
        : undefined,
    )
    .exhaustive()
}

/** The destination partition is exclusively owned by the import until its write settles. */
export function canCloseBrowserImportWizard(step: BrowserImportWizardStep) {
  return step.step !== 'importing'
}

export function initialBrowserImportWizardStep(
  source: BrowserImportSource,
): BrowserImportWizardStep {
  if (source.unavailable === 'browser-running') return { step: 'quit' }
  if (source.unavailable === 'needs-full-disk-access') {
    return { step: 'full-disk-access', resume: 'configure' }
  }
  if (source.unavailable !== undefined) {
    return { step: 'blocked', reason: source.unavailable }
  }
  if (source.profiles.length === 0) {
    return { step: 'blocked', reason: 'unknown-source-profile' }
  }
  return { step: 'configure' }
}

export function guidedImportResultToStep(
  outcome: GuidedBrowserImportResult,
): BrowserImportWizardStep {
  if (outcome.ok) {
    return {
      step: 'done',
      imported: outcome.result.imported,
      skipped: outcome.result.skipped,
      skippedDomains: outcome.result.skippedDomains,
      targetName: outcome.targetName,
      createdProfile: outcome.createdProfile !== null,
    }
  }
  if (outcome.reason === 'browser-running') return { step: 'quit' }
  if (outcome.reason === 'needs-full-disk-access') {
    return { step: 'full-disk-access', resume: 'import', checked: true }
  }
  return { step: 'blocked', reason: outcome.reason }
}

export function refreshedBrowserImportSourceStep(
  source: BrowserImportSource | undefined,
): BrowserImportWizardStep {
  return source
    ? initialBrowserImportWizardStep(source)
    : { step: 'blocked', reason: 'unknown-source' }
}

export function fullDiskAccessRecheckStep(
  source: BrowserImportSource | undefined,
): BrowserImportWizardStep {
  const next = refreshedBrowserImportSourceStep(source)
  return next.step === 'full-disk-access' ? { ...next, checked: true } : next
}

export function refreshedSourceProfileDirectory(
  currentDirectory: string,
  source: BrowserImportSource,
) {
  return source.profiles.some((profile) => profile.directory === currentDirectory)
    ? currentDirectory
    : (source.profiles[0]?.directory ?? '')
}

export type BrowserImportBlockedAction = 'retry' | 'configure' | 'refresh' | 'none'

/** Recovery affordance for each terminal failure, kept exhaustive as reasons evolve. */
export function browserImportBlockedAction(
  reason: BrowserImportFailureReason,
): BrowserImportBlockedAction {
  return match(reason)
    .with(
      'needs-keychain-approval',
      'keychain-item-missing',
      'keychain-unavailable',
      'permission-denied',
      'read-failed',
      'session-unavailable',
      'profile-not-saved',
      () => 'retry' as const,
    )
    .with('unknown-target-profile', 'profile-limit-reached', () => 'configure' as const)
    .with('unknown-source-profile', () => 'refresh' as const)
    .with(
      'not-installed',
      'needs-full-disk-access',
      'browser-running',
      'unsupported-platform',
      'unknown-source',
      'resource-limit',
      'profile-cleanup-failed',
      () => 'none' as const,
    )
    .exhaustive()
}

export function formatSkippedDomains(domains: readonly string[]) {
  if (domains.length === 0) return ''
  if (domains.length === 1) return domains[0] ?? ''
  if (domains.length <= VISIBLE_SKIPPED_DOMAINS) {
    return `${domains.slice(0, -1).join(', ')} and ${domains.at(-1)}`
  }
  return `${domains.slice(0, VISIBLE_SKIPPED_DOMAINS).join(', ')} and ${String(domains.length - VISIBLE_SKIPPED_DOMAINS)} more`
}
