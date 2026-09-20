import type {
  GitActionPhase,
  GitRunStackedActionFailure,
  GitRunStackedActionOptions,
  GitStackedActionBranchOutcome,
  GitStackedActionErrorCode,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  VcsChangeRequest,
} from '@shared/types/git'
import { resolveAutoFeatureBranchName } from '@shared/utils/git-stacked-action'
import { buildOpenChangeRequestPayload } from './stacked-action-change-request'
import type { StackedActionDeps } from './stacked-action-deps'

type PhaseReporter = (phase: GitActionPhase, label: string) => void

export function stackedActionFailure(
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

function preflightFailureMessage(readiness: SourceControlAuthResult) {
  if (!readiness.ok) return readiness.message
  return 'Authenticate the source-control CLI before creating this change request.'
}

export async function preflightChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
): Promise<
  | { readonly ok: true; readonly payload: OpenChangeRequestPayload | null }
  | { readonly ok: false; readonly failure: GitRunStackedActionFailure }
> {
  if (!phases.includes('pr')) return { ok: true, payload: null }
  const prospectiveBranch = options.createFeatureBranch
    ? ({
        status: 'created',
        name: resolveAutoFeatureBranchName([], options.featureBranchName),
      } satisfies GitStackedActionBranchOutcome)
    : ({ status: 'unchanged', name: null } satisfies GitStackedActionBranchOutcome)
  const [readiness, pushDestination] = await Promise.all([
    deps.preflightChangeRequest(projectPath),
    deps.resolveApprovedPushDestination(projectPath, prospectiveBranch.name),
  ])
  const payload = pushDestination
    ? await buildOpenChangeRequestPayload(
        deps,
        projectPath,
        options,
        prospectiveBranch,
        pushDestination,
      )
    : null
  if (!payload) {
    return {
      ok: false,
      failure: stackedActionFailure(
        'pr',
        'change-request-failed',
        'The approved Git push destination is not compatible with this change request.',
      ),
    }
  }
  if (readiness.ok && readiness.status.authenticated) return { ok: true, payload }
  const fallbackUrl = payload
    ? await deps.buildChangeRequestFallbackUrl(projectPath, payload, false)
    : null
  return {
    ok: false,
    failure: stackedActionFailure(
      'pr',
      'change-request-failed',
      preflightFailureMessage(readiness),
      { ...(fallbackUrl ? { fallbackUrl } : {}) },
    ),
  }
}

export async function maybeCommit(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  phases: readonly GitActionPhase[],
  hasChanges: boolean,
  report: PhaseReporter,
) {
  if (!phases.includes('commit') || (options.action !== 'commit' && !hasChanges)) {
    return { ok: true, commit: null } as const
  }
  const message = options.commitMessage?.trim()
  if (!message) {
    return {
      ok: false,
      failure: stackedActionFailure(
        'commit',
        'commit-message-required',
        'A commit message is required for this action.',
      ),
    } as const
  }
  report('commit', 'Committing...')
  const commit = await deps.commit(
    projectPath,
    message,
    options.paths,
    options.includeUnstaged !== false,
  )
  if (commit.ok) return { ok: true, commit } as const
  const code = commit.code === 'nothing-to-commit' ? 'nothing-to-commit' : 'unknown'
  return { ok: false, failure: stackedActionFailure('commit', code, commit.message) } as const
}

export async function maybePush(
  deps: StackedActionDeps,
  projectPath: string,
  phases: readonly GitActionPhase[],
  report: PhaseReporter,
) {
  if (!phases.includes('push')) return { ok: true, destination: undefined } as const
  report('push', 'Pushing...')
  const push = await deps.push(projectPath)
  if (push.ok) return { ok: true, destination: push.destination } as const
  return {
    ok: false,
    failure: stackedActionFailure(
      'push',
      push.code === 'no-upstream' ? 'no-upstream' : 'push-failed',
      push.message,
    ),
  } as const
}

export async function maybeOpenChangeRequest(
  deps: StackedActionDeps,
  projectPath: string,
  phases: readonly GitActionPhase[],
  payload: OpenChangeRequestPayload | null,
  report: PhaseReporter,
): Promise<
  | { ok: true; changeRequest: VcsChangeRequest | null }
  | { ok: false; failure: GitRunStackedActionFailure }
> {
  if (!phases.includes('pr')) return { ok: true, changeRequest: null }
  report('pr', 'Creating change request...')
  if (!payload) {
    return {
      ok: false,
      failure: stackedActionFailure(
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
        failure: stackedActionFailure('pr', 'change-request-failed', result.message, {
          ...(fallbackUrl ? { fallbackUrl } : {}),
        }),
      }
}

export async function createFeatureBranch(
  deps: StackedActionDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  report: PhaseReporter,
) {
  report('branch', 'Preparing feature ref...')
  const requested = options.featureBranchName?.trim()
  const preferred = options.exactFeatureBranchName
    ? (requested ?? '')
    : resolveAutoFeatureBranchName([], requested)
  if (!preferred) return null
  const currentRef = await deps.resolveCurrentRef(projectPath)
  if (currentRef === preferred) {
    return { status: 'unchanged', name: currentRef } satisfies GitStackedActionBranchOutcome
  }
  // Exact branch names come from the commit/push dialog and must preserve the live checkout.
  // The renderer's status snapshot can be stale by the time this mutation owns the Git lock.
  const baseRef = options.exactFeatureBranchName
    ? 'HEAD'
    : (options.baseRef ?? (await deps.resolveDefaultBaseRef(projectPath)))
  if (!baseRef) return null
  const name = options.exactFeatureBranchName
    ? preferred
    : resolveAutoFeatureBranchName(await deps.listBranchNames(projectPath), requested)
  const created = await deps.createBranch(projectPath, name, baseRef)
  if (!created.ok) return null
  return { status: 'created', name } satisfies GitStackedActionBranchOutcome
}
