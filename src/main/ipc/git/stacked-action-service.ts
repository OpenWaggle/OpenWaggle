import type {
  ChangeRequestResult,
  GitActionPhase,
  GitActionProgressEvent,
  GitCommitResult,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedActionBranchOutcome,
  GitStackedActionErrorCode,
  OpenChangeRequestPayload,
  VcsChangeRequest,
} from '@shared/types/git'
import {
  buildGitActionProgressStages,
  planStackedActionPhases,
} from '@shared/utils/git-stacked-action'
import type { GitPullResult, GitPushResult } from './push-service'

/**
 * Injected git capabilities so the workflow can be orchestrated and tested
 * without a real repository. The IPC handler supplies real implementations.
 */
export interface StackedActionDeps {
  readonly hasWorkingTreeChanges: (projectPath: string) => Promise<boolean>
  readonly listBranchNames: (projectPath: string) => Promise<readonly string[]>
  readonly createBranch: (
    projectPath: string,
    name: string,
    baseRef: string | undefined,
  ) => Promise<{ ok: boolean; message: string }>
  readonly commit: (projectPath: string, message: string) => Promise<GitCommitResult>
  readonly push: (projectPath: string) => Promise<GitPushResult>
  readonly pull: (projectPath: string) => Promise<GitPullResult>
  readonly openChangeRequest: (
    projectPath: string,
    payload: OpenChangeRequestPayload,
  ) => Promise<ChangeRequestResult>
}

export type ProgressReporter = (event: GitActionProgressEvent) => void

const DUPLICATE_BRANCH_START_SUFFIX = 2

function failure(
  phase: GitActionPhase,
  code: GitStackedActionErrorCode,
  message: string,
): GitRunStackedActionResult {
  return { ok: false, phase, code, message }
}

function unchangedBranch(): GitStackedActionBranchOutcome {
  return { status: 'unchanged', name: null }
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
  const hasChanges = await deps.hasWorkingTreeChanges(projectPath)
  const report = createReporter(options, hasChanges, onProgress)

  if (options.action === 'pull') {
    report('push', 'Pulling...')
    const pull = await deps.pull(projectPath)
    return pull.ok
      ? { ok: true, action: 'pull', branch: unchangedBranch(), changeRequest: null }
      : failure('push', 'pull-failed', pull.message)
  }

  const branch = options.createFeatureBranch
    ? await createFeatureBranch(deps, projectPath, options, report)
    : unchangedBranch()
  if (branch === null) return failure('branch', 'branch-failed', 'Failed to create feature ref.')

  const phases = planStackedActionPhases(options.action)

  const commitFailure = await maybeCommit(deps, projectPath, options, phases, hasChanges, report)
  if (commitFailure) return commitFailure

  const pushFailure = await maybePush(deps, projectPath, phases, report)
  if (pushFailure) return pushFailure

  const prOutcome = await maybeOpenChangeRequest(deps, projectPath, options, phases, branch, report)
  if (!prOutcome.ok) return prOutcome.failure

  return { ok: true, action: options.action, branch, changeRequest: prOutcome.changeRequest }
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
  if (!phases.includes('commit') || (options.action !== 'commit' && !hasChanges)) return null
  report('commit', 'Committing...')
  const commit = await deps.commit(projectPath, options.commitMessage?.trim() || 'Update')
  if (commit.ok) return null
  const code = commit.code === 'nothing-to-commit' ? 'nothing-to-commit' : 'unknown'
  return failure('commit', code, commit.message)
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
  | { ok: false; failure: GitRunStackedActionResult }
> {
  if (!phases.includes('pr')) return { ok: true, changeRequest: null }
  report('pr', 'Creating change request...')
  const payload: OpenChangeRequestPayload = {
    headRef: branch.name ?? '',
    baseRef: options.baseRef ?? '',
    title: options.changeRequestTitle?.trim() || 'Update',
    body: options.changeRequestBody,
    draft: options.draft,
  }
  const result = await deps.openChangeRequest(projectPath, payload)
  return result.ok
    ? { ok: true, changeRequest: result.changeRequest }
    : { ok: false, failure: failure('pr', 'change-request-failed', result.message) }
}

async function createFeatureBranch(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  report: (phase: GitActionPhase, label: string) => void,
) {
  report('branch', 'Preparing feature ref...')
  const existing = await deps.listBranchNames(projectPath)
  const name = options.featureBranchName?.trim() || fallbackFeatureBranch(existing)
  const created = await deps.createBranch(projectPath, name, options.baseRef)
  if (!created.ok) return null
  return { status: 'created', name } satisfies GitStackedActionBranchOutcome
}

function fallbackFeatureBranch(existing: readonly string[]) {
  const base = 'feature/update'
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let suffix = DUPLICATE_BRANCH_START_SUFFIX
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
