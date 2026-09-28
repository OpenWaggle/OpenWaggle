import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../../logger'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { BoundWorkspaceResource } from '../../../store/session-details'
import {
  fetchRemoteBranch,
  isLocalBranch,
  localBranchIsBehindRemote,
  pullCurrentBranchFastForward,
  resolveTrackedBranch,
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
  options: {
    readonly signal?: AbortSignal
    /** Called just before the network fetch, so the launch can say what it is waiting for. */
    readonly onFetch?: (base: string) => void
  } = {},
): Promise<string | null> {
  const chosen = workspace.worktreeBaseRef?.trim()
  const base = chosen && chosen.length > 0 ? chosen : await resolveCurrentBranch(projectPath)
  if (!base) return null
  if (await isLocalBranch(projectPath, base)) {
    options.onFetch?.(base)
    await fetchRemoteBranch(projectPath, base, options.signal ? { signal: options.signal } : {})
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
 *
 * A branch with no upstream is skipped before any network work: `git pull` would only fail, after
 * waiting on the Git network lock. The pull is reported as a launch step, because it runs before Pi
 * starts and the first send would otherwise sit silent for as long as the remote takes.
 */
export function refreshFirstRunBranch(
  input: AgentKernelRunInput,
  executionPath: string,
  onProgress?: (progress: WorktreeLaunchProgress) => void,
) {
  if (input.session.environmentMode === 'worktree' || input.session.messages.length !== 0) {
    return Effect.void
  }
  return Effect.tryPromise({
    try: async () => {
      const tracked = await resolveTrackedBranch(executionPath)
      if (!tracked) return { ok: true, skipped: true, message: 'No upstream to pull from.' }
      onProgress?.({
        stage: 'syncing-branch',
        environment: 'local',
        parallel: true,
        label: `Pulling latest changes for ${tracked.branch}`,
        details: [`Pulling ${tracked.upstream} into ${tracked.branch}`],
      })
      try {
        const pulled = await pullCurrentBranchFastForward(executionPath, { signal: input.signal })
        return { ...pulled, skipped: false }
      } finally {
        onProgress?.({
          stage: 'syncing-branch',
          environment: 'local',
          completesStep: true,
          details: [],
        })
      }
    },
    catch: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        if (result.skipped) return
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
