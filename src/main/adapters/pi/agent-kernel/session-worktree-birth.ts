import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { createLogger } from '../../../logger'
import { resolveSessionWorktreeBranch } from '../../../services/git/session-branch-resolution'
// ponytail: direct store import (persistence); route through a session port if the Pi adapter grows more store touchpoints.
import { setSessionWorktree } from '../../../store/session-details'
import { runGit } from '../../git/run-git'
import { createGitWorktree } from '../../git/worktree'
import { requireSessionProjectPath } from './session-manager'

const logger = createLogger('session-worktree-birth')

/** Serialize birth per session so concurrent runs (classic + waggle, double-send) can't race. */
const birthInFlight = new Map<string, Promise<string>>()

/**
 * Birth path for a Session worktree (ADR 0010, WS1b). Serialized per session so
 * a fast double-send or a classic+waggle overlap cannot both run `worktree add`
 * (the loser would otherwise throw on "already exists").
 */
export function ensureSessionWorktreeProjectPath(session: SessionDetail): Promise<string> {
  const key = String(session.id)
  const existing = birthInFlight.get(key)
  if (existing) return existing
  const pending = ensureSessionWorktreeProjectPathUnlocked(session).finally(() => {
    birthInFlight.delete(key)
  })
  birthInFlight.set(key, pending)
  return pending
}

/**
 * Whether `candidatePath` really is a linked worktree of `repositoryPath`.
 *
 * A directory at the deterministic path is not enough: one left over from a moved or re-cloned
 * repository would be adopted and recorded, leaving the agent in a cwd where nothing git-related
 * works. Compared through the common git directory, which every linked worktree of a repository
 * shares.
 */
async function isWorktreeOf(repositoryPath: string, candidatePath: string): Promise<boolean> {
  const [candidate, primary] = await Promise.all([
    runGit(candidatePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    runGit(repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  if (candidate.code !== 0 || primary.code !== 0) return false
  return candidate.stdout.trim() !== '' && candidate.stdout.trim() === primary.stdout.trim()
}

async function ensureSessionWorktreeProjectPathUnlocked(session: SessionDetail): Promise<string> {
  const primaryPath = requireSessionProjectPath(session)

  if (session.environmentMode !== 'worktree') return primaryPath
  const existing = session.worktreePath?.trim()
  if (existing && existsSync(existing)) return existing

  if (existing) {
    /*
     * The recorded worktree is gone (removed by hand, pruned, or recorded on another
     * machine). Do NOT silently create a replacement: the new tree would not contain
     * whatever the old one held, and the user would never be told. The composer blocks
     * the send for this case and offers to recreate or to switch to the opened
     * checkout, so reaching here means something bypassed that gate.
     *
     * Failing loudly is also the only safe option: falling back to the opened checkout
     * would drop the isolation worktree mode exists to provide.
     */
    logger.warn('Session worktree missing; refusing to run', {
      sessionId: String(session.id),
      missingWorktreePath: existing,
    })
    throw new Error(
      "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.",
    )
  }

  const sessionId = String(session.id)
  const worktreePath = worktreePathFor(primaryPath, sessionId)

  /*
   * Adopt an existing worktree at this session's deterministic path instead of creating it again.
   *
   * The `existing` check above reads `session.worktreePath`, which is the *record*. Birth persists
   * that record with SQL but does not mutate the `SessionDetail` it was handed, so a caller holding
   * a pre-birth copy sees null even though the worktree is on disk. Creating again then fails: the
   * directory exists and the branch is already checked out there. Keying idempotency on reality
   * rather than on the record makes a repeat call safe whoever makes it.
   *
   * Adoption is verified, not assumed: the directory has to actually be a worktree of this
   * repository. Adopting on existence alone recorded a stale directory - left behind after the
   * repository was moved or re-cloned - as the session's tree, and the agent then ran with a cwd
   * where every git command failed while turn capture silently no-opped.
   *
   * Checked before the base ref is resolved, because adoption needs no base ref: doing it after
   * meant a repeat call for an existing tree could still fail with "no base branch is resolvable".
   */
  if (existsSync(worktreePath) && (await isWorktreeOf(primaryPath, worktreePath))) {
    await setSessionWorktree(SessionId(sessionId), 'worktree', worktreePath)
    return worktreePath
  }

  const baseRef = await resolveWorktreeBaseRef(session, primaryPath)
  if (!baseRef) {
    throw new Error(
      'Could not create a worktree for this session: no base branch is resolvable. Select a base branch or switch this session to Local mode.',
    )
  }

  const branch = await resolveSessionWorktreeBranch(primaryPath, sessionId)

  const result = await createGitWorktree(primaryPath, { path: worktreePath, branch, baseRef })
  if (!result.ok) {
    throw new Error(
      `Could not create a worktree for this session (${result.code}): ${result.message}. Fix the repository state or switch this session to Local mode.`,
    )
  }
  await setSessionWorktree(SessionId(sessionId), 'worktree', worktreePath)
  /*
   * Deliberately does NOT invalidate the git status cache here. This module is a Pi
   * adapter and must not import from `ipc/`, where the cache lives. The gap is closed
   * without it: birth only happens part-way through a send, and the renderer refreshes
   * on the run's terminal transport event, so the new worktree's status is fetched at
   * turn end. A fresh worktree also has no stale cache entry to begin with.
   */
  return worktreePath
}

/**
 * The Worktree base ref for birth: the composer-chosen ref (optionally forked
 * from origin/<base>), else the current branch, else null (blocks the run).
 */
async function resolveWorktreeBaseRef(
  session: SessionDetail,
  projectPath: string,
): Promise<string | null> {
  const chosen = session.worktreeBaseRef?.trim()
  const base = chosen && chosen.length > 0 ? chosen : await resolveCurrentBranch(projectPath)
  if (!base) return null
  if (session.worktreeStartFromOrigin && !base.includes('/')) return `origin/${base}`
  return base
}

async function resolveCurrentBranch(projectPath: string): Promise<string | null> {
  const branch = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.code === 0 && branch.stdout.trim()) return branch.stdout.trim()
  return null
}

function worktreePathFor(primaryPath: string, sessionId: string) {
  const repoName = path.basename(primaryPath.replace(/\/+$/, '')) || 'repo'
  return path.join(homedir(), '.openwaggle', 'worktrees', repoName, sessionId)
}
