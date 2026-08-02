import type { SourceControlProviderId } from '@shared/types/git'

/** Provider-neutral vocabulary for a change request (GitHub PR / GitLab MR). */
export interface ChangeRequestTerminology {
  /** Short label, e.g. "PR" or "MR". */
  readonly shortLabel: string
  /** Singular long name, e.g. "pull request" or "merge request". */
  readonly singular: string
  /** Plural long name, e.g. "pull requests". */
  readonly plural: string
  /** Human provider name, e.g. "GitHub". */
  readonly providerName: string
}

export const DEFAULT_CHANGE_REQUEST_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: 'PR',
  singular: 'pull request',
  plural: 'pull requests',
  providerName: 'Git',
}

const GITHUB_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: 'PR',
  singular: 'pull request',
  plural: 'pull requests',
  providerName: 'GitHub',
}

const GITLAB_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: 'MR',
  singular: 'merge request',
  plural: 'merge requests',
  providerName: 'GitLab',
}

export function getChangeRequestTerminology(
  provider: SourceControlProviderId | null | undefined,
): ChangeRequestTerminology {
  if (provider === 'github') return GITHUB_TERMINOLOGY
  if (provider === 'gitlab') return GITLAB_TERMINOLOGY
  return DEFAULT_CHANGE_REQUEST_TERMINOLOGY
}

/** e.g. "Create PR" / "Create MR". */
export function formatCreateChangeRequest(
  provider: SourceControlProviderId | null | undefined,
): string {
  return `Create ${getChangeRequestTerminology(provider).shortLabel}`
}

/** e.g. "View PR" / "View MR". */
export function formatViewChangeRequest(
  provider: SourceControlProviderId | null | undefined,
): string {
  return `View ${getChangeRequestTerminology(provider).shortLabel}`
}
