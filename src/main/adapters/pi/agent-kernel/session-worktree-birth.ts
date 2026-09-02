import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { WorktreeLaunchProgress } from '@shared/types/background-run'
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

interface SessionWorktreeBirthOptions {
  readonly onProgress?: (progress: WorktreeLaunchProgress) => void
  readonly signal?: AbortSignal
}

/**
 * Birth path for a Session worktree (ADR 0010, WS1b). Serialized per session so
 * a fast double-send or a classic+waggle overlap cannot both run `worktree add`
 * (the loser would otherwise throw on "already exists").
 */
export async function ensureSessionWorktreeProjectPath(
  session: SessionDetail,
  options: SessionWorktreeBirthOptions = {},
): Promise<string> {
  // Local-mode recovery must not join an older in-flight worktree birth for this session.
  if (session.environmentMode !== 'worktree') {
    return requireSessionProjectPath(session)
  }
  const key = String(session.id)
  const existing = birthInFlight.get(key)
  if (existing) {
    try {
      return await existing
    } catch (error) {
      options.signal?.throwIfAborted()
      if (!(error instanceof Error) || error.name !== 'AbortError') throw error
      /*
       * A replacement send must not inherit the cancelled run's signal. Once the
       * shared birth settles, retry under this caller's still-live signal. The
       * deterministic path check below makes this safe even if Git completed the
       * add just before the old caller observed cancellation.
       */
      return ensureSessionWorktreeProjectPath(session, options)
    }
  }
  const pending = ensureSessionWorktreeProjectPathUnlocked(session, options).finally(() => {
    birthInFlight.delete(key)
  })
  birthInFlight.set(key, pending)
  return await pending
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

async function ensureSessionWorktreeProjectPathUnlocked(
  session: SessionDetail,
  options: SessionWorktreeBirthOptions,
): Promise<string> {
  const primaryPath = requireSessionProjectPath(session)

  if (session.environmentMode !== 'worktree') return primaryPath
  const existing = session.worktreePath?.trim()
  /*
   * The recorded path is verified, not merely checked for existence - the same reason the deterministic
   * path is. A directory left behind after the repository was moved or re-cloned would otherwise be handed
   * to the agent as its working tree, where every git command fails and turn capture silently no-ops. A
   * record that no longer names a worktree of this repository is treated as a missing worktree, which the
   * send gate already knows how to recover from.
   */
  if (existing && existsSync(existing) && (await isWorktreeOf(primaryPath, existing))) {
    return existing
  }

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
  if (existsSync(worktreePath)) {
    if (await isWorktreeOf(primaryPath, worktreePath)) {
      options.onProgress?.({
        stage: 'preparing-workspace',
        details: ['Recovering the session worktree'],
      })
      await setSessionWorktree(SessionId(sessionId), 'worktree', worktreePath)
      options.onProgress?.({
        stage: 'worktree-created',
        details: ['Recovered the existing session worktree'],
        worktreePath,
      })
      return worktreePath
    }
    /*
     * Something else occupies this session's deterministic path - a directory left behind after the
     * repository was moved or re-cloned. Refusing to adopt it is right, but falling through to
     * `git worktree add` was not: that cannot write into a non-empty directory, so every send failed
     * with git's own message and the session had no route back, since no worktree was ever recorded
     * for the recover-or-switch gate to offer. Say what is in the way and what to do about it.
     */
    logger.warn('A non-worktree directory occupies the session worktree path', {
      sessionId,
      worktreePath,
    })
    options.onProgress?.({
      stage: 'preparing-workspace',
      details: ['Preparing the session worktree'],
    })
    throw new Error(
      `Cannot create this session's worktree: ${worktreePath} already exists and is not a worktree of this repository. Remove or rename that directory, or switch this session to the current checkout.`,
    )
  }

  options.onProgress?.({
    stage: 'preparing-workspace',
    details: ['Preparing the session worktree'],
  })

  return createAndPersistSessionWorktree({
    session,
    options,
    primaryPath,
    sessionId,
    worktreePath,
  })
}

async function createAndPersistSessionWorktree(input: {
  readonly session: SessionDetail
  readonly options: SessionWorktreeBirthOptions
  readonly primaryPath: string
  readonly sessionId: string
  readonly worktreePath: string
}) {
  const { session, options, primaryPath, sessionId, worktreePath } = input

  const baseRef = await resolveWorktreeBaseRef(session, primaryPath)
  if (!baseRef) {
    throw new Error(
      'Could not create a worktree for this session: no base branch is resolvable. Select a base branch or switch this session to Local mode.',
    )
  }

  const branch = await resolveSessionWorktreeBranch(primaryPath, sessionId)

  options.onProgress?.({
    stage: 'checking-out-files',
    details: [`Creating ${branch} from ${baseRef}`],
    worktreePath,
    branch,
    baseRef,
  })

  options.signal?.throwIfAborted()
  const createPayload = { path: worktreePath, branch, baseRef }
  const result = options.signal
    ? await createGitWorktree(primaryPath, createPayload, { signal: options.signal })
    : await createGitWorktree(primaryPath, createPayload)
  options.signal?.throwIfAborted()
  if (!result.ok) {
    throw new Error(
      `Could not create a worktree for this session (${result.code}): ${result.message}. Fix the repository state or switch this session to Local mode.`,
    )
  }
  await setSessionWorktree(SessionId(sessionId), 'worktree', worktreePath)
  options.onProgress?.({
    stage: 'worktree-created',
    details: [`Created ${branch} from ${baseRef}`],
    worktreePath,
    branch,
    baseRef,
  })
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
