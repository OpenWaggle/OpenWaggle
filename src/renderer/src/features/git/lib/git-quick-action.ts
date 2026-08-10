import type { GitStackedAction, VcsStatus } from '@shared/types/git'
import {
  type ChangeRequestTerminology,
  getChangeRequestTerminology,
} from '@shared/utils/source-control-presentation'

export type GitActionIconName = 'commit' | 'push' | 'pr'

export interface GitActionMenuItem {
  readonly id: 'commit' | 'push' | 'pr'
  readonly label: string
  readonly disabled: boolean
  readonly icon: GitActionIconName
  readonly kind: 'open_dialog' | 'open_pr'
  readonly dialogAction?: 'commit' | 'push' | 'create_pr'
}

export interface GitQuickAction {
  readonly label: string
  readonly disabled: boolean
  readonly kind: 'run_action' | 'run_pull' | 'open_pr' | 'open_publish' | 'show_hint'
  readonly action?: GitStackedAction
  readonly hint?: string
}

function terminologyFor(status: VcsStatus | null): ChangeRequestTerminology {
  return getChangeRequestTerminology(status?.sourceControlProvider?.id)
}

/**
 * Compute the single next-best git action from combined VCS status.
 * Ported from T3Code GitActionsControl.logic.ts::resolveQuickAction, adapted to
 * OpenWaggle's VcsStatus (isDefaultRef/hasPrimaryRemote read from status).
 */
export function resolveQuickAction(status: VcsStatus | null, isBusy: boolean): GitQuickAction {
  if (isBusy) {
    return { label: 'Commit', disabled: true, kind: 'show_hint', hint: 'Git action in progress.' }
  }
  if (!status) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Git status is unavailable.',
    }
  }

  const terminology = terminologyFor(status)
  const hasBranch = status.refName !== null
  const hasChanges = status.hasWorkingTreeChanges
  const hasOpenPr = status.changeRequest?.state === 'open'
  const isAhead = status.aheadCount > 0
  const isBehind = status.behindCount > 0
  const isDiverged = isAhead && isBehind
  const isDefaultRef = status.isDefaultRef
  const hasPrimaryRemote = status.hasPrimaryRemote
  const hasDefaultBranchDelta = (status.aheadOfDefaultCount ?? status.aheadCount) > 0

  if (!hasBranch) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: `Create and checkout a ref before pushing or opening a ${terminology.singular}.`,
    }
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
    return {
      label: 'Sync ref',
      disabled: true,
      kind: 'show_hint',
      hint: 'Branch has diverged from upstream. Rebase/merge first.',
    }
  }
  if (isBehind) return { label: 'Pull', disabled: false, kind: 'run_pull' }
  if (isAhead) return resolveAheadQuickAction({ hasOpenPr, isDefaultRef, terminology })

  if (hasOpenPr)
    return { label: `View ${terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: `Create ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'create_pr',
    }
  }
  return {
    label: 'Commit',
    disabled: true,
    kind: 'show_hint',
    hint: 'Branch is up to date. No action needed.',
  }
}

function resolveDirtyQuickAction(input: {
  hasUpstream: boolean
  hasPrimaryRemote: boolean
  hasOpenPr: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}): GitQuickAction {
  if (!input.hasUpstream && !input.hasPrimaryRemote) {
    return { label: 'Commit', disabled: false, kind: 'run_action', action: 'commit' }
  }
  if (input.hasOpenPr || input.isDefaultRef) {
    return { label: 'Commit & push', disabled: false, kind: 'run_action', action: 'commit_push' }
  }
  return {
    label: `Commit, push & ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'commit_push_pr',
  }
}

function resolveNoUpstreamQuickAction(input: {
  hasPrimaryRemote: boolean
  hasOpenPr: boolean
  isAhead: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}): GitQuickAction {
  if (!input.hasPrimaryRemote) {
    if (input.hasOpenPr && !input.isAhead) {
      return { label: `View ${input.terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
    }
    return { label: 'Publish repository', disabled: false, kind: 'open_publish' }
  }
  if (!input.isAhead) {
    if (input.hasOpenPr) {
      return { label: `View ${input.terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
    }
    return { label: 'Push', disabled: true, kind: 'show_hint', hint: 'No local commits to push.' }
  }
  if (input.hasOpenPr || input.isDefaultRef) {
    return {
      label: 'Push',
      disabled: false,
      kind: 'run_action',
      action: input.isDefaultRef ? 'commit_push' : 'push',
    }
  }
  return {
    label: `Push & create ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'create_pr',
  }
}

function resolveAheadQuickAction(input: {
  hasOpenPr: boolean
  isDefaultRef: boolean
  terminology: ChangeRequestTerminology
}): GitQuickAction {
  if (input.hasOpenPr || input.isDefaultRef) {
    return {
      label: 'Push',
      disabled: false,
      kind: 'run_action',
      action: input.isDefaultRef ? 'commit_push' : 'push',
    }
  }
  return {
    label: `Push & create ${input.terminology.shortLabel}`,
    disabled: false,
    kind: 'run_action',
    action: 'create_pr',
  }
}

/** Build the git action menu items (commit / push / PR) from combined VCS status. */
export function buildMenuItems(status: VcsStatus | null, isBusy: boolean): GitActionMenuItem[] {
  if (!status) return []
  const commitItem = buildCommitItem(status, isBusy)
  if (!status.hasPrimaryRemote) return [commitItem]
  return [commitItem, buildPushItem(status, isBusy), buildChangeRequestItem(status, isBusy)]
}

function buildCommitItem(status: VcsStatus, isBusy: boolean): GitActionMenuItem {
  return {
    id: 'commit',
    label: 'Commit',
    disabled: isBusy || !status.hasWorkingTreeChanges,
    icon: 'commit',
    kind: 'open_dialog',
    dialogAction: 'commit',
  }
}

function canPushFromStatus(status: VcsStatus, isBusy: boolean) {
  const canPushWithoutUpstream = status.hasPrimaryRemote && !status.hasUpstream
  return (
    !isBusy &&
    status.refName !== null &&
    status.behindCount === 0 &&
    status.aheadCount > 0 &&
    (status.hasUpstream || canPushWithoutUpstream)
  )
}

function buildPushItem(status: VcsStatus, isBusy: boolean): GitActionMenuItem {
  return {
    id: 'push',
    label: 'Push',
    disabled: !canPushFromStatus(status, isBusy),
    icon: 'push',
    kind: 'open_dialog',
    dialogAction: 'push',
  }
}

function buildChangeRequestItem(status: VcsStatus, isBusy: boolean): GitActionMenuItem {
  const terminology = terminologyFor(status)
  if (status.changeRequest?.state === 'open') {
    return {
      id: 'pr',
      label: `View ${terminology.shortLabel}`,
      disabled: isBusy,
      icon: 'pr',
      kind: 'open_pr',
    }
  }
  const canPushWithoutUpstream = status.hasPrimaryRemote && !status.hasUpstream
  const hasDefaultBranchDelta = (status.aheadOfDefaultCount ?? status.aheadCount) > 0
  const canCreatePr =
    !isBusy &&
    status.refName !== null &&
    !status.hasWorkingTreeChanges &&
    hasDefaultBranchDelta &&
    status.behindCount === 0 &&
    (status.hasUpstream || canPushWithoutUpstream)
  return {
    id: 'pr',
    label: `Create ${terminology.shortLabel}`,
    disabled: !canCreatePr,
    icon: 'pr',
    kind: 'open_dialog',
    dialogAction: 'create_pr',
  }
}
