import type {
  GitActionPhase,
  GitActionProgressEvent,
  GitRunStackedActionFailure,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitRunStackedActionSuccess,
  GitStackedActionBranchOutcome,
} from '@shared/types/git'
import {
  buildGitActionProgressStages,
  planStackedActionPhases,
} from '@shared/utils/git-stacked-action'
import type { StackedActionDeps } from './stacked-action-deps'
import {
  createFeatureBranch,
  maybeCommit,
  maybeOpenChangeRequest,
  maybePush,
  preflightChangeRequest,
  stackedActionFailure,
} from './stacked-action-phases'

export type { StackedActionDeps } from './stacked-action-deps'

export type ProgressReporter = (event: GitActionProgressEvent) => void
export type CancellationProbe = () => boolean
type StackedCommit = NonNullable<GitRunStackedActionSuccess['commit']>

function unchangedBranch(): GitStackedActionBranchOutcome {
  return { status: 'unchanged', name: null }
}

function withPreparedBranch(
  result: GitRunStackedActionFailure,
  branch: GitStackedActionBranchOutcome,
) {
  return branch.name ? { ...result, branch } : result
}

function withCommit(
  result: GitRunStackedActionFailure,
  commit: StackedCommit | null,
): GitRunStackedActionFailure {
  return commit
    ? {
        ...result,
        commit,
        ...(commit.commitOutput ? { commitOutput: commit.commitOutput } : {}),
      }
    : result
}

/**
 * Orchestrate a stacked git action server-side. Steps run in order and stop at
 * the first failure (centralized partial-failure handling); progress events are
 * emitted per stage in the phases branch -> commit -> push -> pr.
 */
export async function runStackedGitAction(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  onProgress: ProgressReporter = () => {},
  isCancelled: CancellationProbe = () => false,
): Promise<GitRunStackedActionResult> {
  const phases = planStackedActionPhases(options.action)
  const firstPhase = options.createFeatureBranch ? 'branch' : (phases[0] ?? 'commit')
  if (isCancelled()) return stackedActionFailure(firstPhase, 'cancelled', 'Action cancelled.')
  const probe = await deps.hasWorkingTreeChanges(projectPath)
  if (!probe.ok) {
    return {
      ok: false,
      phase: 'commit',
      code: 'unknown',
      message: probe.message,
    }
  }
  const hasChanges = probe.hasChanges
  const report = createReporter(options, hasChanges, onProgress)
  if (isCancelled()) return stackedActionFailure(firstPhase, 'cancelled', 'Action cancelled.')

  if (options.action === 'pull') {
    report('push', 'Pulling...')
    const pull = await deps.pull(projectPath)
    return pull.ok
      ? { ok: true, action: 'pull', branch: unchangedBranch(), commit: null, changeRequest: null }
      : stackedActionFailure('push', 'pull-failed', pull.message)
  }

  const preflight = await preflightChangeRequest(deps, projectPath, options, phases)
  if (!preflight.ok) return preflight.failure
  if (isCancelled()) return stackedActionFailure(firstPhase, 'cancelled', 'Action cancelled.')
  return runMutationSequence(
    deps,
    projectPath,
    options,
    phases,
    hasChanges,
    preflight.payload,
    report,
    isCancelled,
  )
}

async function runMutationSequence(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  hasChanges: boolean,
  preflightPayload: Parameters<StackedActionDeps['openChangeRequest']>[1] | null,
  report: (phase: GitActionPhase, label: string) => void,
  isCancelled: CancellationProbe,
): Promise<GitRunStackedActionResult> {
  const branch = options.createFeatureBranch
    ? await createFeatureBranch(deps, projectPath, options, report)
    : unchangedBranch()
  if (branch === null) {
    return stackedActionFailure('branch', 'branch-failed', 'Failed to create feature ref.')
  }
  if (isCancelled()) {
    const message =
      branch.status === 'created'
        ? `Branch "${branch.name ?? ''}" was created. The next Git step was cancelled before it started.`
        : 'Action cancelled.'
    return withPreparedBranch(
      stackedActionFailure(phases.includes('commit') ? 'commit' : 'push', 'cancelled', message),
      branch,
    )
  }

  const commitOutcome = await maybeCommit(deps, projectPath, options, phases, hasChanges, report)
  if (!commitOutcome.ok) return withPreparedBranch(commitOutcome.failure, branch)
  if (isCancelled() && phases.includes('push')) {
    return withCommit(
      withPreparedBranch(
        stackedActionFailure(
          'push',
          'cancelled',
          'Commit created. Push cancelled before it started.',
        ),
        branch,
      ),
      commitOutcome.commit,
    )
  }

  return runPushAndChangeRequest(
    deps,
    projectPath,
    options,
    phases,
    branch,
    commitOutcome.commit,
    preflightPayload,
    report,
    isCancelled,
  )
}

async function runPushAndChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  branch: GitStackedActionBranchOutcome,
  commit: StackedCommit | null,
  preflightPayload: Parameters<StackedActionDeps['openChangeRequest']>[1] | null,
  report: (phase: GitActionPhase, label: string) => void,
  isCancelled: CancellationProbe,
): Promise<GitRunStackedActionResult> {
  const pushOutcome = await maybePush(deps, projectPath, phases, report)
  if (!pushOutcome.ok) {
    return withCommit(withPreparedBranch(pushOutcome.failure, branch), commit)
  }
  if (isCancelled() && phases.includes('pr')) {
    return withCommit(
      withPreparedBranch(
        stackedActionFailure(
          'pr',
          'cancelled',
          'Push completed. Change request creation was cancelled before it started.',
        ),
        branch,
      ),
      commit,
    )
  }

  const prOutcome = await maybeOpenChangeRequest(
    deps,
    projectPath,
    phases,
    preflightPayload,
    report,
  )
  if (!prOutcome.ok) {
    return withCommit(withPreparedBranch(prOutcome.failure, branch), commit)
  }

  return {
    ok: true,
    action: options.action,
    branch,
    commit,
    ...(commit?.commitOutput ? { commitOutput: commit.commitOutput } : {}),
    changeRequest: prOutcome.changeRequest,
  }
}

function createReporter(
  options: GitRunStackedActionOptions,
  hasChanges: boolean,
  onProgress: ProgressReporter,
) {
  const total = buildGitActionProgressStages({
    action: options.action,
    hasCustomCommitMessage: Boolean(options.commitMessage?.trim()),
    hasWorkingTreeChanges: hasChanges,
    featureBranch: options.createFeatureBranch === true,
  }).length
  let index = 0
  return (phase: GitActionPhase, label: string) => {
    onProgress({ phase, label, index, total })
    index += 1
  }
}
