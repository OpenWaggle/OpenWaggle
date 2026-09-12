import { realpath } from 'node:fs/promises'
import type {
  GitWorktreeCreatePayload,
  GitWorktreeInfo,
  GitWorktreeListResult,
  GitWorktreeMutationFailure,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
} from '@shared/types/git'
import { isGitRepository, runGit } from './run-git'

function runWorktreeGit(projectPath: string, args: string[], signal?: AbortSignal) {
  return signal ? runGit(projectPath, args, { signal }) : runGit(projectPath, args)
}

function throwIfGitAborted(signal?: AbortSignal, result?: { readonly aborted?: boolean }) {
  signal?.throwIfAborted()
  if (!result?.aborted) return
  const error = new Error('Git operation was aborted.')
  error.name = 'AbortError'
  throw error
}

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

/**
 * The worktree path that currently has `branch` checked out, or null when nothing does.
 *
 * Parses `git worktree list --porcelain`, whose records are `worktree <path>` followed by
 * `branch refs/heads/<name>` for attached worktrees (detached ones report `detached` instead).
 */
/** Whether two paths name the same tree, resolving symlinks; falls back to a plain compare. */
async function isSamePath(left: string, right: string): Promise<boolean> {
  if (left === right) return true
  try {
    return (await realpath(left)) === (await realpath(right))
  } catch {
    return false
  }
}

async function branchWorktreeHolder(
  projectPath: string,
  branch: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await runWorktreeGit(projectPath, ['worktree', 'list', '--porcelain'], signal)
  throwIfGitAborted(signal, result)
  if (result.code !== 0) return null

  let currentPath: string | null = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim()
      continue
    }
    if (line === `branch refs/heads/${branch}`) return currentPath
  }
  return null
}

export async function createGitWorktree(
  projectPath: string,
  payload: GitWorktreeCreatePayload,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GitWorktreeMutationResult> {
  throwIfGitAborted(options.signal)
  if (!(await isGitRepository(projectPath))) {
    return worktreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  throwIfGitAborted(options.signal)

  const baseRef = payload.baseRef.trim()
  const branch = payload.branch.trim()
  const worktreePath = payload.path.trim()
  if (!baseRef) return worktreeFailure('base-ref-not-found', 'A base ref is required.')
  if (!branch) return worktreeFailure('unknown', 'A worktree branch name is required.')
  if (!worktreePath) return worktreeFailure('unknown', 'A worktree path is required.')

  const verifyBase = await runWorktreeGit(
    projectPath,
    ['rev-parse', '--verify', `${baseRef}^{commit}`],
    options.signal,
  )
  throwIfGitAborted(options.signal, verifyBase)
  if (verifyBase.code !== 0) {
    return worktreeFailure('base-ref-not-found', `Base ref "${baseRef}" could not be resolved.`)
  }

  // Clear stale registrations (e.g. a worktree directory deleted out-of-band)
  // so re-creating at the same path doesn't fail with "already registered".
  const prune = await runWorktreeGit(projectPath, ['worktree', 'prune'], options.signal)
  throwIfGitAborted(options.signal, prune)

  /*
   * Pruning clears the stale registration but NOT the branch. A session whose
   * worktree directory was deleted out-of-band (rm -rf, a wiped disk, a checkout
   * from another machine) still owns its `ow/session-*` branch, and `worktree add -b`
   * fails with "a branch named ... already exists" — which left that session
   * permanently unable to run.
   *
   * Attach to the surviving branch rather than deleting and recreating it: it may
   * carry commits the agent already made, and discarding those to obtain a clean
   * slate would be silent data loss.
   */
  const branchExists = await runWorktreeGit(
    projectPath,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    options.signal,
  )
  throwIfGitAborted(options.signal, branchExists)

  /*
   * Attaching is only safe when nothing else holds the branch. `git worktree add <path>
   * <branch>` refuses when the branch is checked out in another worktree, but it reports that
   * with a message that classified as `unknown` - and if the other worktree had since been
   * removed while its branch survived, the add would *succeed* and silently hand this session
   * the other session's commits. Check explicitly and fail with a code that says what happened.
   */
  if (branchExists.code === 0) {
    const holder = await branchWorktreeHolder(projectPath, branch, options.signal)
    /*
     * Compared through realpath. `git worktree list` prints the canonical path, so a requested path
     * that traverses a symlink - a temporary directory under /var on macOS, for example - never
     * matched, and the caller was told the branch was checked out in the very path it had asked for
     * instead of getting `worktree-exists`. The two codes are semantically distinct on purpose.
     */
    if (holder !== null && !(await isSamePath(holder, worktreePath))) {
      return worktreeFailure(
        'branch-checked-out-elsewhere',
        `Branch "${branch}" is already checked out in ${holder}.`,
      )
    }
  }

  const addArgs =
    branchExists.code === 0
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath, baseRef]

  const result = await runWorktreeGit(projectPath, addArgs, options.signal)
  throwIfGitAborted(options.signal, result)
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

export async function validateGitWorktreeRemoval(
  projectPath: string,
  payload: GitWorktreeRemovePayload,
): Promise<GitWorktreeMutationResult> {
  if (!(await isGitRepository(projectPath))) {
    return worktreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  const worktreePath = payload.path.trim()
  if (!worktreePath) return worktreeFailure('not-found', 'A worktree path is required.')
  const listed = await listGitWorktrees(projectPath)
  let registered = false
  for (const worktree of listed.worktrees) {
    if (await isSamePath(worktree.path, worktreePath)) {
      registered = true
      break
    }
  }
  if (!registered) return worktreeFailure('not-found', 'Worktree not found.')
  const status = await runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.code !== 0)
    return worktreeFailure('unknown', status.stderr || 'Worktree check failed.')
  if (status.stdout.trim()) {
    return worktreeFailure(
      'dirty-worktree',
      'Worktree has uncommitted changes. Commit, push, or force-remove to discard them.',
    )
  }
  return { ok: true, message: 'Worktree can be removed.', path: worktreePath }
}
