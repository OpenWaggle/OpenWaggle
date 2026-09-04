import type {
  ChangeRequestResult,
  GitActionPhase,
  GitActionProgressEvent,
  GitCommitResult,
  GitRunStackedActionFailure,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedActionBranchOutcome,
  GitStackedActionErrorCode,
  GitStackedActionProbeFailure,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  VcsChangeRequest,
} from '@shared/types/git'
import {
  buildGitActionProgressStages,
  planStackedActionPhases,
  resolveAutoFeatureBranchName,
} from '@shared/utils/git-stacked-action'
import type { GitPullResult, GitPushResult } from './push-service'

/**
 * Injected git capabilities so the workflow can be orchestrated and tested
 * without a real repository. The IPC handler supplies real implementations.
 */
export interface StackedActionDeps {
  /**
   * Whether the working tree has changes, or a failure when that cannot be determined.
   *
   * Returning a plain boolean meant a failing `git status` (locked index, unreadable repository)
   * looked exactly like "clean", which made the commit phase silently skip for `commit_push`
   * actions - the action then reported success having committed nothing.
   */
  readonly hasWorkingTreeChanges: (
    projectPath: string,
  ) => Promise<{ readonly ok: true; readonly hasChanges: boolean } | GitStackedActionProbeFailure>
  readonly listBranchNames: (projectPath: string) => Promise<readonly string[]>
  readonly createBranch: (
    projectPath: string,
    name: string,
    baseRef: string | undefined,
  ) => Promise<{ ok: boolean; message: string }>
  readonly commit: (
    projectPath: string,
    message: string,
    paths?: readonly string[],
  ) => Promise<GitCommitResult>
  readonly push: (projectPath: string) => Promise<GitPushResult>
  readonly pull: (projectPath: string) => Promise<GitPullResult>
  readonly openChangeRequest: (
    projectPath: string,
    payload: OpenChangeRequestPayload,
  ) => Promise<ChangeRequestResult>
  /** Current checked-out branch (head ref for a change request when no feature branch was created). */
  readonly resolveCurrentRef: (projectPath: string) => Promise<string | null>
  /** Default branch (base ref for a change request when the caller did not specify one). */
  readonly resolveDefaultBaseRef: (projectPath: string) => Promise<string | null>
  /** Read-only provider availability/authentication check. Must run before a PR/MR workflow mutates git. */
  readonly preflightChangeRequest: (projectPath: string) => Promise<SourceControlAuthResult>
  readonly buildChangeRequestFallbackUrl: (
    projectPath: string,
    payload: OpenChangeRequestPayload,
    headRefAvailableRemotely: boolean,
  ) => Promise<string | null>
}

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

function withOutcomes(
  result: GitRunStackedActionFailure,
  branch: GitStackedActionBranchOutcome,
  commitHash: string | null = null,
) {
  return { ...result, ...(branch.name ? { branch } : {}), ...(commitHash ? { commitHash } : {}) }
}

/** Runs branch -> commit -> push -> PR and stops at the first failure. */
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
      ? { ok: true, action: 'pull', branch: unchangedBranch(), changeRequest: null }
      : failure('push', 'pull-failed', pull.message)
  }

  const preflightFailure = await preflightChangeRequest(deps, projectPath, options, phases)
  if (preflightFailure) return preflightFailure

  const branch = options.createFeatureBranch
    ? await createFeatureBranch(deps, projectPath, options, report)
    : unchangedBranch()
  if (branch === null) return failure('branch', 'branch-failed', 'Failed to create feature ref.')

  const commit = await maybeCommit(deps, projectPath, options, phases, hasChanges, report)
  if (commit.failure) return withOutcomes(commit.failure, branch)

  const pushFailure = await maybePush(deps, projectPath, phases, report)
  if (pushFailure) return withOutcomes(pushFailure, branch, commit.commitHash)

  const prOutcome = await maybeOpenChangeRequest(deps, projectPath, options, phases, branch, report)
  if (!prOutcome.ok) {
    return withOutcomes(prOutcome.failure, branch, commit.commitHash)
  }

  return {
    ok: true,
    action: options.action,
    branch,
    ...(commit.commitHash ? { commitHash: commit.commitHash } : {}),
    changeRequest: prOutcome.changeRequest,
  }
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

  const fallbackUrl = await preflightFallbackUrl(deps, projectPath, options)
  return failure('pr', 'change-request-failed', preflightFailureMessage(readiness), {
    ...(fallbackUrl ? { fallbackUrl } : {}),
  })
}

function preflightFailureMessage(readiness: SourceControlAuthResult) {
  if (!readiness.ok) return readiness.message
  return 'Authenticate the source-control CLI before creating this change request.'
}

async function preflightFallbackUrl(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
) {
  const headRef = options.createFeatureBranch
    ? options.featureBranchName?.trim()
    : (await deps.resolveCurrentRef(projectPath))?.trim()
  if (!headRef) return null
  const baseRef =
    (options.baseRef ?? (await deps.resolveDefaultBaseRef(projectPath)))?.trim() || undefined
  const payload: OpenChangeRequestPayload = {
    headRef,
    ...(baseRef ? { baseRef } : {}),
    title: options.changeRequestTitle?.trim() || 'Update',
    body: options.changeRequestBody,
    draft: options.draft,
  }
  return deps.buildChangeRequestFallbackUrl(projectPath, payload, false)
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
    return { failure: null, commitHash: null }
  }
  // Never invent a commit message: an unreviewed blanket "Update" commit is not an
  // acceptable default for a one-click action (review B2).
  const message = options.commitMessage?.trim()
  if (!message) {
    return {
      failure: failure(
        'commit',
        'commit-message-required',
        'A commit message is required for this action.',
      ),
      commitHash: null,
    }
  }
  report('commit', 'Committing...')
  const commit = await deps.commit(projectPath, message, options.paths)
  if (commit.ok) return { failure: null, commitHash: commit.commitHash }
  const code = commit.code === 'nothing-to-commit' ? 'nothing-to-commit' : 'unknown'
  return { failure: failure('commit', code, commit.message), commitHash: null }
}

async function maybePush(
  deps: StackedActionDeps,
  projectPath: string,
  phases: readonly GitActionPhase[],
  report: (phase: GitActionPhase, label: string) => void,
) {
  if (!phases.includes('push')) return null
  report('push', 'Pushing...')
  const push = await deps.push(projectPath)
  if (push.ok) return null
  return failure('push', push.code === 'no-upstream' ? 'no-upstream' : 'push-failed', push.message)
}

async function maybeOpenChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  branch: GitStackedActionBranchOutcome,
  report: (phase: GitActionPhase, label: string) => void,
): Promise<
  | { ok: true; changeRequest: VcsChangeRequest | null }
  | { ok: false; failure: GitRunStackedActionFailure }
> {
  if (!phases.includes('pr')) return { ok: true, changeRequest: null }
  report('pr', 'Creating change request...')
  const headRef = (branch.name ?? (await deps.resolveCurrentRef(projectPath)))?.trim() || ''
  const baseRef =
    (options.baseRef ?? (await deps.resolveDefaultBaseRef(projectPath)))?.trim() || undefined
  if (!headRef) {
    return {
      ok: false,
      failure: failure(
        'pr',
        'change-request-failed',
        'Could not resolve the head ref for the change request.',
      ),
    }
  }
  const payload: OpenChangeRequestPayload = {
    headRef,
    ...(baseRef ? { baseRef } : {}),
    title: options.changeRequestTitle?.trim() || 'Update',
    body: options.changeRequestBody,
    draft: options.draft,
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
