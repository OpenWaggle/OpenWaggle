import type {
  GitActionPhase,
  GitActionProgressEvent,
  GitRunStackedActionFailure,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedActionBranchOutcome,
  GitStackedActionErrorCode,
  SourceControlAuthResult,
  VcsChangeRequest,
} from '@shared/types/git'
import {
  buildGitActionProgressStages,
  planStackedActionPhases,
  resolveAutoFeatureBranchName,
} from '@shared/utils/git-stacked-action'
import type { GitPushDestination } from './push-service'
import { buildOpenChangeRequestPayload } from './stacked-action-change-request'
import type { StackedActionDeps } from './stacked-action-deps'

export type { StackedActionDeps } from './stacked-action-deps'

export type ProgressReporter = (event: GitActionProgressEvent) => void

function failure(
  phase: GitActionPhase,
  code: GitStackedActionErrorCode,
  message: string,
  details: {
    readonly branch?: GitStackedActionBranchOutcome
    readonly fallbackUrl?: string
  } = {},
): GitRunStackedActionFailure {
  return { ok: false, phase, code, message, ...details }
}

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
  commit: { readonly commitHash: string; readonly summary: string } | null,
): GitRunStackedActionFailure {
  return commit ? { ...result, commit } : result
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
): Promise<GitRunStackedActionResult> {
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
  const phases = planStackedActionPhases(options.action)

  if (options.action === 'pull') {
    report('push', 'Pulling...')
    const pull = await deps.pull(projectPath)
    return pull.ok
      ? { ok: true, action: 'pull', branch: unchangedBranch(), commit: null, changeRequest: null }
      : failure('push', 'pull-failed', pull.message)
  }

  const preflightFailure = await preflightChangeRequest(deps, projectPath, options, phases)
  if (preflightFailure) return preflightFailure

  const branch = options.createFeatureBranch
    ? await createFeatureBranch(deps, projectPath, options, report)
    : unchangedBranch()
  if (branch === null) return failure('branch', 'branch-failed', 'Failed to create feature ref.')

  const commitOutcome = await maybeCommit(deps, projectPath, options, phases, hasChanges, report)
  if (!commitOutcome.ok) return withPreparedBranch(commitOutcome.failure, branch)

  const pushOutcome = await maybePush(deps, projectPath, phases, report)
  if (!pushOutcome.ok) {
    return withCommit(withPreparedBranch(pushOutcome.failure, branch), commitOutcome.commit)
  }

  const prOutcome = await maybeOpenChangeRequest(
    deps,
    projectPath,
    options,
    phases,
    branch,
    pushOutcome.destination,
    report,
  )
  if (!prOutcome.ok) {
    return withCommit(withPreparedBranch(prOutcome.failure, branch), commitOutcome.commit)
  }

  return {
    ok: true,
    action: options.action,
    branch,
    commit: commitOutcome.commit,
    changeRequest: prOutcome.changeRequest,
  }
}

function preflightFailureMessage(readiness: SourceControlAuthResult) {
  if (!readiness.ok) return readiness.message
  return 'Authenticate the source-control CLI before creating this change request.'
}

async function preflightChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
): Promise<GitRunStackedActionFailure | null> {
  if (!phases.includes('pr')) return null
  const readiness = await deps.preflightChangeRequest(projectPath)
  if (readiness.ok && readiness.status.authenticated) return null

  const prospectiveBranch = options.createFeatureBranch
    ? ({
        status: 'created',
        name: resolveAutoFeatureBranchName([], options.featureBranchName),
      } satisfies GitStackedActionBranchOutcome)
    : unchangedBranch()
  const payload = await buildOpenChangeRequestPayload(
    deps,
    projectPath,
    options,
    prospectiveBranch,
    undefined,
  )
  const fallbackUrl = payload
    ? await deps.buildChangeRequestFallbackUrl(projectPath, payload, false)
    : null
  return failure('pr', 'change-request-failed', preflightFailureMessage(readiness), {
    ...(fallbackUrl ? { fallbackUrl } : {}),
  })
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

async function maybeCommit(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  hasChanges: boolean,
  report: (phase: GitActionPhase, label: string) => void,
) {
  if (!phases.includes('commit') || (options.action !== 'commit' && !hasChanges)) {
    return { ok: true, commit: null } as const
  }
  // Never invent a commit message: an unreviewed blanket "Update" commit is not an
  // acceptable default for a one-click action (review B2).
  const message = options.commitMessage?.trim()
  if (!message) {
    return {
      ok: false,
      failure: failure(
        'commit',
        'commit-message-required',
        'A commit message is required for this action.',
      ),
    } as const
  }
  report('commit', 'Committing...')
  const commit = await deps.commit(projectPath, message, options.paths)
  if (commit.ok) return { ok: true, commit } as const
  const code = commit.code === 'nothing-to-commit' ? 'nothing-to-commit' : 'unknown'
  return { ok: false, failure: failure('commit', code, commit.message) } as const
}

async function maybePush(
  deps: StackedActionDeps,
  projectPath: string,
  phases: readonly GitActionPhase[],
  report: (phase: GitActionPhase, label: string) => void,
) {
  if (!phases.includes('push')) return { ok: true, destination: undefined } as const
  report('push', 'Pushing...')
  const push = await deps.push(projectPath)
  if (push.ok) return { ok: true, destination: push.destination } as const
  return {
    ok: false,
    failure: failure(
      'push',
      push.code === 'no-upstream' ? 'no-upstream' : 'push-failed',
      push.message,
    ),
  } as const
}

async function maybeOpenChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  branch: GitStackedActionBranchOutcome,
  pushDestination: GitPushDestination | undefined,
  report: (phase: GitActionPhase, label: string) => void,
): Promise<
  | { ok: true; changeRequest: VcsChangeRequest | null }
  | { ok: false; failure: GitRunStackedActionFailure }
> {
  if (!phases.includes('pr')) return { ok: true, changeRequest: null }
  report('pr', 'Creating change request...')
  const payload = await buildOpenChangeRequestPayload(
    deps,
    projectPath,
    options,
    branch,
    pushDestination,
  )
  if (!payload) {
    return {
      ok: false,
      failure: failure(
        'pr',
        'change-request-failed',
        'Could not resolve the head ref for the change request.',
      ),
    }
  }
  const result = await deps.openChangeRequest(projectPath, payload)
  const fallbackUrl = result.ok
    ? null
    : await deps.buildChangeRequestFallbackUrl(projectPath, payload, true)
  return result.ok
    ? { ok: true, changeRequest: result.changeRequest }
    : {
        ok: false,
        failure: failure('pr', 'change-request-failed', result.message, {
          ...(fallbackUrl ? { fallbackUrl } : {}),
        }),
      }
}

async function createFeatureBranch(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  report: (phase: GitActionPhase, label: string) => void,
) {
  report('branch', 'Preparing feature ref...')
  const preferred = resolveAutoFeatureBranchName([], options.featureBranchName)
  const currentRef = await deps.resolveCurrentRef(projectPath)
  if (currentRef === preferred) {
    return { status: 'unchanged', name: currentRef } satisfies GitStackedActionBranchOutcome
  }
  const baseRef = options.baseRef ?? (await deps.resolveDefaultBaseRef(projectPath))
  if (!baseRef) return null
  const existing = await deps.listBranchNames(projectPath)
  const name = resolveAutoFeatureBranchName(existing, options.featureBranchName)
  const created = await deps.createBranch(projectPath, name, baseRef)
  if (!created.ok) return null
  return { status: 'created', name } satisfies GitStackedActionBranchOutcome
}
