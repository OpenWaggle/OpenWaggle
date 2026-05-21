import type { GitBranchMutationFailure } from '@shared/types/git'

export function branchFailure(
  code: GitBranchMutationFailure['code'],
  message: string,
): GitBranchMutationFailure {
  return { ok: false, code, message }
}

export function mapBranchFailure(stderr: string): GitBranchMutationFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

  if (lower.includes('not a git repository')) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  if (lower.includes('already exists')) {
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  }
  if (lower.includes('upstream branch') && lower.includes('does not exist')) {
    return branchFailure('upstream-not-found', 'The selected upstream branch does not exist.')
  }
  if (isMissingBranchError(lower)) {
    return branchFailure('branch-not-found', 'The requested branch could not be found.')
  }
  if (isDirtyWorktreeError(lower)) {
    return branchFailure(
      'dirty-worktree',
      'Commit or stash local changes before switching branches.',
    )
  }
  if (isInvalidNameError(lower)) {
    return branchFailure('invalid-name', 'Branch name is invalid.')
  }
  if (isCurrentBranchDeleteError(lower)) {
    return branchFailure(
      'unknown',
      'Cannot delete the currently checked out branch. Switch branches and try again.',
    )
  }

  return branchFailure('unknown', message || 'Git branch operation failed.')
}

function isMissingBranchError(lower: string) {
  return (
    lower.includes('did not match any file') ||
    lower.includes('unknown revision') ||
    lower.includes("isn't a commit") ||
    lower.includes('not found')
  )
}

function isDirtyWorktreeError(lower: string) {
  return (
    lower.includes('local changes') ||
    lower.includes('would be overwritten by checkout') ||
    lower.includes('please commit your changes or stash')
  )
}

function isInvalidNameError(lower: string) {
  return (
    lower.includes('is not a valid branch name') ||
    lower.includes('not a valid object name') ||
    lower.includes('invalid refspec') ||
    lower.includes('invalid branch name')
  )
}

function isCurrentBranchDeleteError(lower: string) {
  return (
    lower.includes('cannot delete branch') &&
    (lower.includes('checked out') || lower.includes('currently checked out'))
  )
}
