import type { GitStackedAction, VcsStatus } from '@shared/types/git'
import {
  type ChangeRequestTerminology,
  getChangeRequestTerminology,
} from '@shared/utils/source-control-presentation'

export interface GitQuickAction {
  readonly label: string
  readonly disabled: boolean
  readonly kind: 'run_action' | 'run_pull' | 'open_pr' | 'open_publish' | 'show_hint'
  readonly action?: GitStackedAction
  readonly hint?: string
}

function terminologyFor(status: VcsStatus | null) {
  return getChangeRequestTerminology(status?.sourceControlProvider?.id)
}

function hasOpenChangeRequest(status: VcsStatus) {
  return status.changeRequest?.state === 'open' || status.changeRequest?.state === 'draft'
}

/**
 * Compute the single next-best git action from combined VCS status.
 *
 * One button, one obvious next step, rather than exposing every git verb at once:
 * publish when there is no remote, open the change request when one exists, pull
 * when behind, otherwise commit. `isDefaultRef` and `hasPrimaryRemote` are read
 * from status so the decision needs no extra git calls.
 */
export function resolveQuickAction(status: VcsStatus | null, isBusy: boolean) {
  if (isBusy) {
    const result: GitQuickAction = {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Git action in progress.',
    }
    return result
  }
  if (!status) {
    const result: GitQuickAction = {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Git status is unavailable.',
    }
    return result
  }

  const terminology = terminologyFor(status)
  const hasBranch = status.refName !== null
  const hasChanges = status.hasWorkingTreeChanges
  const hasOpenPr = hasOpenChangeRequest(status)
  const isAhead = status.aheadCount > 0
  const isBehind = status.behindCount > 0
  const isDiverged = isAhead && isBehind
  const isDefaultRef = status.isDefaultRef
  const hasPrimaryRemote = status.hasPrimaryRemote
  const hasDefaultBranchDelta = (status.aheadOfDefaultCount ?? status.aheadCount) > 0

  if (!hasBranch) {
    const result: GitQuickAction = {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: `Create and checkout a ref before pushing or opening a ${terminology.singular}.`,
    }
    return result
  }

  if (hasChanges) {
    return resolveDirtyQuickAction({
      hasUpstream: status.hasUpstream,
      hasPrimaryRemote,
      hasOpenPr,
      isDefaultRef,
      terminology,
    })
  }

  if (!status.hasUpstream) {
    return resolveNoUpstreamQuickAction({
      hasPrimaryRemote,
      hasOpenPr,
      isAhead,
      isDefaultRef,
      terminology,
    })
  }

  if (isDiverged) {
    const result: GitQuickAction = {
      label: 'Sync ref',
      disabled: true,
      kind: 'show_hint',
      hint: 'Branch has diverged from upstream. Rebase/merge first.',
    }
    return result
  }
  if (isBehind) {
    const result: GitQuickAction = { label: 'Pull', disabled: false, kind: 'run_pull' }
    return result
  }
  if (isAhead) return resolveAheadQuickAction({ hasOpenPr, isDefaultRef, terminology })

  if (hasOpenPr) {
    const result: GitQuickAction = {
      label: `View ${terminology.shortLabel}`,
      disabled: false,
      kind: 'open_pr',
    }
    return result
  }
  if (hasDefaultBranchDelta && !isDefaultRef) {
    const result: GitQuickAction = {
      label: `Create ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'create_pr',
    }
    return result
  }
  const result: GitQuickAction = {
    label: 'Commit',
    disabled: true,
    kind: 'show_hint',
    hint: 'Branch is up to date. No action needed.',
  }
  return result
}

function resolveDirtyQuickAction(input: {
  hasUpstream: boolean
  hasPrimaryRemote: boolean
  hasOpenPr: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}) {
  if (!input.hasUpstream && !input.hasPrimaryRemote) {
    const result: GitQuickAction = {
      label: 'Commit',
      disabled: false,
      kind: 'run_action',
      action: 'commit',
    }
    return result
  }
  if (input.hasOpenPr || input.isDefaultRef) {
    const result: GitQuickAction = {
      label: 'Commit & push',
      disabled: false,
      kind: 'run_action',
      action: 'commit_push',
    }
    return result
  }
  const result: GitQuickAction = {
    label: `Commit, push & ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'commit_push_pr',
  }
  return result
}

function resolveNoUpstreamQuickAction(input: {
  hasPrimaryRemote: boolean
  hasOpenPr: boolean
  isAhead: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}) {
  if (!input.hasPrimaryRemote) {
    if (input.hasOpenPr && !input.isAhead) {
      const result: GitQuickAction = {
        label: `View ${input.terminology.shortLabel}`,
        disabled: false,
        kind: 'open_pr',
      }
      return result
    }
    const result: GitQuickAction = {
      label: 'Publish repository',
      disabled: false,
      kind: 'open_publish',
    }
    return result
  }
  if (!input.isAhead) {
    if (input.hasOpenPr) {
      const result: GitQuickAction = {
        label: `View ${input.terminology.shortLabel}`,
        disabled: false,
        kind: 'open_pr',
      }
      return result
    }
    const result: GitQuickAction = {
      label: 'Push',
      disabled: true,
      kind: 'show_hint',
      hint: 'No local commits to push.',
    }
    return result
  }
  if (input.hasOpenPr || input.isDefaultRef) {
    /*
     * `push`, never `commit_push`. These branches are only reached with a clean tree, and main
     * skips the commit phase when there is nothing to commit - but the panel opens its Commit
     * message dialog for any action whose id starts with "commit". Pressing a button labelled
     * "Push" therefore demanded a commit message under "0 changed files will be committed", and
     * then threw the message away. The default-ref confirmation still fires: `push` is one of the
     * actions it gates.
     */
    const result: GitQuickAction = {
      label: 'Push',
      disabled: false,
      kind: 'run_action',
      action: 'push',
    }
    return result
  }
  const result: GitQuickAction = {
    label: `Push & create ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'create_pr',
  }
  return result
}

function resolveAheadQuickAction(input: {
  hasOpenPr: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}) {
  if (input.hasOpenPr || input.isDefaultRef) {
    /*
     * `push`, never `commit_push`. These branches are only reached with a clean tree, and main
     * skips the commit phase when there is nothing to commit - but the panel opens its Commit
     * message dialog for any action whose id starts with "commit". Pressing a button labelled
     * "Push" therefore demanded a commit message under "0 changed files will be committed", and
     * then threw the message away. The default-ref confirmation still fires: `push` is one of the
     * actions it gates.
     */
    const result: GitQuickAction = {
      label: 'Push',
      disabled: false,
      kind: 'run_action',
      action: 'push',
    }
    return result
  }
  const result: GitQuickAction = {
    label: `Push & create ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'create_pr',
  }
  return result
}
