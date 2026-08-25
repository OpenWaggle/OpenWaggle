import { match } from '@diegogbrisa/ts-match'
import type { GitActionPhase, GitStackedAction, SourceControlProviderId } from '@shared/types/git'
import type { LocalVcsStatus } from '../types/vcs'
import {
  type ChangeRequestTerminology,
  DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
  getChangeRequestTerminology,
} from './source-control-presentation'

const AUTO_FEATURE_BRANCH_FALLBACK = 'feature/update'
const BRANCH_FRAGMENT_MAX_LENGTH = 64
const FIRST_DUPLICATE_SUFFIX = 2

export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/^[./\s_-]+|[./\s_-]+$/g, '')

  const fragment = normalized
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./_-]+|[./_-]+$/g, '')
    .slice(0, BRANCH_FRAGMENT_MAX_LENGTH)
    .replace(/[./_-]+$/g, '')

  return fragment.length > 0 ? fragment : 'update'
}

export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw)
  if (sanitized.includes('/')) {
    return sanitized.startsWith('feature/') ? sanitized : `feature/${sanitized}`
  }
  return `feature/${sanitized}`
}

/** Pick a unique feature branch name given the existing branch names. */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim()
  const base = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  )
  const existing = new Set(existingBranchNames.map((name) => name.toLowerCase()))
  if (!existing.has(base)) return base

  let suffix = FIRST_DUPLICATE_SUFFIX
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/** Ordered progress-stage labels for a stacked action, shown as it advances. */
export function buildGitActionProgressStages(input: {
  action: GitStackedAction
  hasCustomCommitMessage: boolean
  hasWorkingTreeChanges: boolean
  pushTarget?: string
  featureBranch?: boolean
  shouldPushBeforePr?: boolean
  terminology?: ChangeRequestTerminology
}): string[] {
  const terminology = input.terminology ?? DEFAULT_CHANGE_REQUEST_TERMINOLOGY
  const branchStages = input.featureBranch ? ['Preparing feature ref...'] : []
  const pushStage = input.pushTarget ? `Pushing to ${input.pushTarget}...` : 'Pushing...'
  const prStages = [
    `Preparing ${terminology.shortLabel}...`,
    `Generating ${terminology.shortLabel} content...`,
    `Creating ${terminology.singular}...`,
  ]

  if (input.action === 'push') return [pushStage]
  if (input.action === 'pull') return ['Pulling...']
  if (input.action === 'create_pr') {
    return input.shouldPushBeforePr ? [pushStage, ...prStages] : prStages
  }

  const includeCommit = input.action === 'commit' || input.hasWorkingTreeChanges
  const commitStages = !includeCommit
    ? []
    : input.hasCustomCommitMessage
      ? ['Committing...']
      : ['Generating commit message...', 'Committing...']

  if (input.action === 'commit') return [...branchStages, ...commitStages]
  if (input.action === 'commit_push') return [...branchStages, ...commitStages, pushStage]
  return [...branchStages, ...commitStages, pushStage, ...prStages]
}

export type DefaultBranchConfirmableAction = 'push' | 'create_pr' | 'commit_push' | 'commit_push_pr'

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultRef: boolean,
): action is DefaultBranchConfirmableAction {
  if (!isDefaultRef) return false
  return (
    action === 'push' ||
    action === 'create_pr' ||
    action === 'commit_push' ||
    action === 'commit_push_pr'
  )
}

export interface DefaultBranchActionDialogCopy {
  readonly title: string
  readonly description: string
  readonly continueLabel: string
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction
  branchName: string
  includesCommit: boolean
  provider?: SourceControlProviderId | null
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName
  const suffix = ` on "${branchLabel}". You can continue on this ref or create a feature ref and run the same action there.`
  const terminology = getChangeRequestTerminology(input.provider)

  if (input.action === 'push' || input.action === 'commit_push') {
    if (input.includesCommit) {
      return {
        title: 'Commit & push to default ref?',
        description: `This action will commit and push changes${suffix}`,
        continueLabel: `Commit & push to ${branchLabel}`,
      }
    }
    return {
      title: 'Push to default ref?',
      description: `This action will push local commits${suffix}`,
      continueLabel: `Push to ${branchLabel}`,
    }
  }

  if (input.includesCommit) {
    return {
      title: `Commit, push & create ${terminology.shortLabel} from default ref?`,
      description: `This action will commit, push, and create a ${terminology.singular}${suffix}`,
      continueLabel: `Commit, push & create ${terminology.shortLabel}`,
    }
  }
  return {
    title: `Push & create ${terminology.shortLabel} from default ref?`,
    description: `This action will push local commits and create a ${terminology.singular}${suffix}`,
    continueLabel: `Push & create ${terminology.shortLabel}`,
  }
}

/** Ordered phases a stacked action executes; used to sequence the workflow. */
export function planStackedActionPhases(action: GitStackedAction): readonly GitActionPhase[] {
  return match(action)
    .with('commit', () => ['commit'] as const)
    .with('push', () => ['push'] as const)
    .with('pull', () => ['push'] as const)
    .with('create_pr', () => ['push', 'pr'] as const)
    .with('commit_push', () => ['commit', 'push'] as const)
    .with('commit_push_pr', () => ['commit', 'push', 'pr'] as const)
    .exhaustive()
}

/**
 * Whether a stacked action would write the default branch, from either end.
 *
 * A push follows the upstream mapping, so standing on `feature` with an upstream of `origin/main` writes `main` -
 * verified against real git, which reported `feature -> main`. Judging only the ref you are on waved that
 * straight through, which is precisely the push the confirmation exists to catch.
 */
export function targetsDefaultRef(
  status: Pick<LocalVcsStatus, 'isDefaultRef' | 'pushTargetIsDefaultRef'>,
): boolean {
  return status.isDefaultRef || status.pushTargetIsDefaultRef
}

/**
 * The branch the confirmation should name: the destination when a push would write somewhere else.
 *
 * Telling the user "you are on feature" while the push updates `main` is worse than not asking, because it
 * invites them to confirm the wrong thing.
 */
export function defaultBranchActionLabel(
  status: Pick<
    LocalVcsStatus,
    'isDefaultRef' | 'pushTargetIsDefaultRef' | 'pushTargetRef' | 'refName'
  >,
): string {
  if (!status.isDefaultRef && status.pushTargetIsDefaultRef && status.pushTargetRef !== null) {
    return status.refName === null
      ? status.pushTargetRef
      : `${status.pushTargetRef} (tracked by ${status.refName})`
  }
  return status.refName ?? 'the default branch'
}
