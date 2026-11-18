import type { SessionExportBranchScope } from './types/session-export'

interface SessionExportBranchSelection {
  readonly branchScope?: SessionExportBranchScope
  readonly branchId?: string
}

/** A branch can be named only for an active-branch export; a tree export covers every branch. */
export function sessionExportBranchSelectionIsValid(
  branchScope: SessionExportBranchScope | undefined,
  branchId: string | undefined,
) {
  return branchScope !== 'tree' || branchId === undefined
}

export function assertSessionExportBranchSelection(input: SessionExportBranchSelection) {
  if (!sessionExportBranchSelectionIsValid(input.branchScope, input.branchId)) {
    throw new Error('A Session branch can be selected only for an active-branch export.')
  }
}
