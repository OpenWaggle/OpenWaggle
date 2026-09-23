import * as Effect from 'effect/Effect'
import { createLogger } from '../../../logger'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { BoundWorkspaceResource } from '../../../store/session-details'
import {
  fetchRemoteBranch,
  isLocalBranch,
  localBranchIsBehindRemote,
  pullCurrentBranchFastForward,
} from '../../git/remote-sync'
import { runGit } from '../../git/run-git'

const logger = createLogger('session-branch-freshness')

/**
 * Branch freshness for a Session's first run, so the agent starts from the selected branch's
 * latest state without the user pulling first:
 *
 * - Worktree birth resolves its base ref here: a chosen local branch (including slash-named
 *   ones) is fetched from `origin` and birth moves to `origin/<base>` when that keeps every
 *   local commit (the local branch is an ancestor of or equal to the remote tip). A local
 *   branch ahead of or diverged from the remote keeps its own tip. Network failures degrade
 *   to the recorded refs — birth never blocks on a fetch.
 * - Local-mode conversations pull the checkout's branch (`--ff-only`) once, on the first
 *   run; later runs never touch the tree mid-conversation.
 */

export async function resolveFreshWorktreeBaseRef(
  workspace: Partial<Pick<BoundWorkspaceResource, 'worktreeBaseRef' | 'worktreeStartFromOrigin'>>,
  projectPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const chosen = workspace.worktreeBaseRef?.trim()
  const base = chosen && chosen.length > 0 ? chosen : await resolveCurrentBranch(projectPath)
  if (!base) return null
  if (await isLocalBranch(projectPath, base)) {
    await fetchRemoteBranch(projectPath, base, signal ? { signal } : {})
    if (workspace.worktreeStartFromOrigin || (await localBranchIsBehindRemote(projectPath, base))) {
      return `origin/${base}`
    }
  }
  return base
}

async function resolveCurrentBranch(projectPath: string): Promise<string | null> {
  const branch = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.code === 0 && branch.stdout.trim()) return branch.stdout.trim()
  return null
}

/**
 * The first run of a local-mode conversation syncs the checkout's branch from its upstream.
 * Best-effort: a failed pull never blocks the turn.
 */
export function refreshFirstRunBranch(input: AgentKernelRunInput, executionPath: string) {
  if (input.session.environmentMode === 'worktree' || input.session.messages.length !== 0) {
    return Effect.void
  }
  return Effect.tryPromise({
    try: () => pullCurrentBranchFastForward(executionPath, { signal: input.signal }),
    catch: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        if (result.ok) {
          logger.info('Synced the Session branch with its upstream before the first run', {
            sessionId: input.session.id,
            executionPath,
          })
        } else {
          logger.warn('Could not sync the Session branch with its upstream before the first run', {
            sessionId: input.session.id,
            executionPath,
            message: result.message,
          })
        }
      }),
    ),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Branch sync before the first run failed', {
          sessionId: input.session.id,
          executionPath,
          error: error.message,
        })
      }),
    ),
  )
}
