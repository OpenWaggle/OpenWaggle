import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { sessionWorktreeBranch } from '@shared/utils/worktree'
import { createLogger } from '../../../logger'
// ponytail: direct store import (persistence); route through a session port if the Pi adapter grows more store touchpoints.
import { setSessionWorktree } from '../../../store/session-details'
import { runGit } from '../../git/run-git'
import { createGitWorktree } from '../../git/worktree'
import { resolveSessionProjectPath } from './session-manager'

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

async function ensureSessionWorktreeProjectPathUnlocked(session: SessionDetail): Promise<string> {
  const primaryPath = resolveSessionProjectPath(session)

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

  const baseRef = await resolveWorktreeBaseRef(session, primaryPath)
  if (!baseRef) {
    throw new Error(
      'Could not create a worktree for this session: no base branch is resolvable. Select a base branch or switch this session to Local mode.',
    )
  }

  const sessionId = String(session.id)
  const worktreePath = worktreePathFor(primaryPath, sessionId)
  const branch = sessionWorktreeBranch(sessionId)

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
