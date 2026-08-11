import type {
  GitWorktreeCreatePayload,
  GitWorktreeInfo,
  GitWorktreeListResult,
  GitWorktreeMutationFailure,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
} from '@shared/types/git'
import { isGitRepository, runGit } from './run-git'

function worktreeFailure(
  code: GitWorktreeMutationFailure['code'],
  message: string,
): GitWorktreeMutationFailure {
  return { ok: false, code, message }
}

function classifyCreateError(stderr: string): GitWorktreeMutationFailure {
  const lower = stderr.toLowerCase()
  if (lower.includes('is not a valid ref') || lower.includes('invalid reference')) {
    return worktreeFailure('base-ref-not-found', stderr.trim() || 'Base ref not found.')
  }
  if (lower.includes('already exists')) {
    if (lower.includes('branch')) {
      return worktreeFailure('branch-exists', stderr.trim() || 'Worktree branch already exists.')
    }
    return worktreeFailure('worktree-exists', stderr.trim() || 'Worktree path already exists.')
  }
  return worktreeFailure('unknown', stderr.trim() || 'Failed to create worktree.')
}

function classifyRemoveError(stderr: string): GitWorktreeMutationFailure {
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

/**
 * Parse `git worktree list --porcelain -z` output into structured worktree info.
 * Records are separated by an empty line; fields are NUL-separated.
 */
export function parseWorktreeList(stdout: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = []
  const records = stdout.split('\0\0').filter((record) => record.replace(/\0/g, '').trim())

  let isFirst = true
  for (const record of records) {
    const fields = record.split('\0').filter(Boolean)
    let path = ''
    let head = ''
    let branch: string | null = null
    let detached = false
    for (const field of fields) {
      if (field.startsWith('worktree ')) {
        path = field.slice('worktree '.length)
        continue
      }
      if (field.startsWith('HEAD ')) {
        head = field.slice('HEAD '.length)
        continue
      }
      if (field.startsWith('branch ')) {
        branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
        continue
      }
      if (field === 'detached') detached = true
    }
    if (!path) continue
    worktrees.push({ path, head, branch: detached ? null : branch, isMain: isFirst })
    isFirst = false
  }

  return worktrees
}

export async function listGitWorktrees(projectPath: string): Promise<GitWorktreeListResult> {
  if (!(await isGitRepository(projectPath))) {
    return { worktrees: [] }
  }
  const result = await runGit(projectPath, ['worktree', 'list', '--porcelain', '-z'])
  if (result.code !== 0) {
    return { worktrees: [] }
  }
  return { worktrees: parseWorktreeList(result.stdout) }
}

export async function createGitWorktree(
  projectPath: string,
  payload: GitWorktreeCreatePayload,
): Promise<GitWorktreeMutationResult> {
  if (!(await isGitRepository(projectPath))) {
    return worktreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const baseRef = payload.baseRef.trim()
  const branch = payload.branch.trim()
  const worktreePath = payload.path.trim()
  if (!baseRef) return worktreeFailure('base-ref-not-found', 'A base ref is required.')
  if (!branch) return worktreeFailure('unknown', 'A worktree branch name is required.')
  if (!worktreePath) return worktreeFailure('unknown', 'A worktree path is required.')

  const verifyBase = await runGit(projectPath, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  if (verifyBase.code !== 0) {
    return worktreeFailure('base-ref-not-found', `Base ref "${baseRef}" could not be resolved.`)
  }

  // Clear stale registrations (e.g. a worktree directory deleted out-of-band)
  // so re-creating at the same path doesn't fail with "already registered".
  await runGit(projectPath, ['worktree', 'prune'])

  const result = await runGit(projectPath, ['worktree', 'add', '-b', branch, worktreePath, baseRef])
  if (result.code !== 0) {
    return classifyCreateError(result.stderr)
  }

  return { ok: true, message: `Created worktree on ${branch}.`, path: worktreePath }
}

export async function removeGitWorktree(
  projectPath: string,
  payload: GitWorktreeRemovePayload,
): Promise<GitWorktreeMutationResult> {
  if (!(await isGitRepository(projectPath))) {
    return worktreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const worktreePath = payload.path.trim()
  if (!worktreePath) return worktreeFailure('not-found', 'A worktree path is required.')

  // Rely on git's native refusal for dirty worktrees; only force on explicit request.
  const args = ['worktree', 'remove', worktreePath]
  if (payload.force) args.push('--force')

  const result = await runGit(projectPath, args)
  if (result.code !== 0) {
    return classifyRemoveError(result.stderr)
  }

  return { ok: true, message: 'Worktree removed.', path: worktreePath }
}
