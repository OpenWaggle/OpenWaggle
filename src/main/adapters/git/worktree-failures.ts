import type { GitWorktreeMutationFailure } from '@shared/types/git'
import { runGit } from './run-git'

export function worktreeFailure(
  code: GitWorktreeMutationFailure['code'],
  message: string,
): GitWorktreeMutationFailure {
  return { ok: false, code, message }
}

export function classifyRemoveError(stderr: string): GitWorktreeMutationFailure {
  const lower = stderr.toLowerCase()
  if (lower.includes('is dirty') || lower.includes('contains modified or untracked')) {
    return worktreeFailure(
      'dirty-worktree',
      stderr.trim() ||
        'Worktree has uncommitted changes. Commit, push, or force-remove to discard them.',
    )
  }
  if (lower.includes('is not a working tree') || lower.includes('not a working tree')) {
    return worktreeFailure('not-found', stderr.trim() || 'Worktree not found.')
  }
  return worktreeFailure('unknown', stderr.trim() || 'Failed to remove worktree.')
}

/** Why a worktree with uncommitted work, or whose work Git cannot report, must be kept. */
export async function uncommittedWorkRefusal(
  worktreePath: string,
): Promise<GitWorktreeMutationFailure | null> {
  const status = await runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.code !== 0)
    return worktreeFailure('unknown', status.stderr || 'Worktree check failed.')
  if (!status.stdout.trim()) return null
  return worktreeFailure(
    'dirty-worktree',
    'Worktree has uncommitted changes. Commit, push, or force-remove to discard them.',
  )
}
