import type { GitRunStackedActionResult, VcsStatus } from '@shared/types/git'

export interface CreatedRequest {
  readonly title: string
  readonly url: string
}

export type ChangeRequestComposerOutcome =
  | {
      readonly kind: 'failed'
      readonly branchName: string | null
      readonly fallbackUrl: string | null
      readonly message: string
    }
  | {
      readonly kind: 'request-output-failed'
      readonly request: CreatedRequest
      readonly message: string
      readonly retryPersisted: boolean
    }
  | {
      readonly kind: 'created-request'
      readonly request: CreatedRequest
      readonly commitOutputMessage: string | null
    }
  | { readonly kind: 'completed'; readonly commitOutputMessage: string | null }

export function startsOnDefaultRef(status: VcsStatus | null) {
  return status?.defaultRef != null && status.refName === status.defaultRef
}

export function resolveBrowserUrl(fallbackUrl: string | null, vcsStatus: VcsStatus | null) {
  return fallbackUrl ?? vcsStatus?.changeRequest?.url ?? null
}

export function outputRecordingError(shortLabel: string) {
  return `${shortLabel} was created, but it could not be added to this session's Outputs. Retry adding it without creating another ${shortLabel}.`
}

export function creationError(cause: unknown, shortLabel: string) {
  return cause instanceof Error ? cause.message : `Could not create ${shortLabel}.`
}

export function createdToast(shortLabel: string, commitOutputMessage: string | null) {
  return {
    message: commitOutputMessage ?? `${shortLabel} created.`,
    variant: commitOutputMessage ? ('error' as const) : ('success' as const),
  }
}

function withCommitOutput(message: string, result: GitRunStackedActionResult) {
  return result.commitOutput?.ok === false ? `${message} ${result.commitOutput.message}` : message
}

export function resolveChangeRequestComposerOutcome(
  result: GitRunStackedActionResult,
): ChangeRequestComposerOutcome {
  if (!result.ok) {
    return {
      kind: 'failed',
      branchName: result.branch?.name ?? null,
      fallbackUrl: result.fallbackUrl ?? null,
      message: withCommitOutput(result.message, result),
    }
  }
  const commitOutputMessage = result.commitOutput?.ok === false ? result.commitOutput.message : null
  if (!result.changeRequest) return { kind: 'completed', commitOutputMessage }
  const request = { title: result.changeRequest.title, url: result.changeRequest.url }
  if (result.changeRequestOutput?.ok === false) {
    return {
      kind: 'request-output-failed',
      request,
      retryPersisted: result.changeRequestOutput.retryPersisted,
      message: withCommitOutput(result.changeRequestOutput.message, result),
    }
  }
  return { kind: 'created-request', request, commitOutputMessage }
}
