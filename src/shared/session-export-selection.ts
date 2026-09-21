import type { SessionExportBranchScope } from './types/session-export'

interface SessionExportBranchSelection {
  readonly branchScope?: SessionExportBranchScope
  readonly branchId?: string
}

export function sessionExportBranchSelectionIsValid(input: SessionExportBranchSelection) {
  return input.branchScope !== 'tree' || input.branchId === undefined
}

export function assertSessionExportBranchSelection(input: SessionExportBranchSelection) {
  if (!sessionExportBranchSelectionIsValid(input)) {
    throw new Error('A Session branch can be selected only for an active-branch export.')
  }
}
