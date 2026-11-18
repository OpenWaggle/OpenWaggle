import type {
  ChangeRequestCheckoutResult,
  ChangeRequestDetailsResult,
  ChangeRequestListResult,
  ChangeRequestMergeMethod,
  ChangeRequestResult,
  MergeChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlProviderId,
  SourceControlRepositoryIdentity,
} from '@shared/types/git'

/** A fork-parent answer: the parent (or null for none), or a failed lookup worth retrying. */
export type ForkParentLookup =
  | { readonly ok: true; readonly parent: SourceControlRepositoryIdentity | null }
  | { readonly ok: false }

/** The head of a change request opened from a fork. */
export interface ForkChangeRequestHead {
  readonly ref: string
  /** GitHub owner of the fork. */
  readonly owner: string
  /** Full GitLab path of the fork project (`namespace/project`). */
  readonly repository: string
}

/**
 * Source control provider port (ADR 0012). Implemented by CLI-backed adapters
 * (gh / glab). All methods return discriminated-union results and never throw;
 * missing CLI or auth failures are surfaced as typed failures.
 */
export interface SourceControlProvider {
  readonly id: SourceControlProviderId
  readonly authStatus: (projectPath: string) => Promise<SourceControlAuthResult>
  readonly openChangeRequest: (
    projectPath: string,
    payload: OpenChangeRequestPayload,
  ) => Promise<ChangeRequestResult>
  readonly resolveChangeRequestForRef: (
    projectPath: string,
    headRef: string,
  ) => Promise<ChangeRequestResult>
  readonly listChangeRequests: (projectPath: string) => Promise<ChangeRequestListResult>
  readonly getChangeRequestDetails: (
    projectPath: string,
    reference: string,
  ) => Promise<ChangeRequestDetailsResult>
  readonly mergeChangeRequest: (
    projectPath: string,
    reference: string,
    method: ChangeRequestMergeMethod,
    expectedHeadCommit: string,
  ) => Promise<MergeChangeRequestResult>
  /**
   * Check a change request out into the working tree at `projectPath` (used to
   * seed a Session worktree). `reference` is a number, URL, or branch name.
   */
  readonly checkoutChangeRequest: (
    projectPath: string,
    reference: string,
  ) => Promise<ChangeRequestCheckoutResult>
  /** Provider account the last repository-scoped command ran as, when known. */
  readonly account: () => string | null
  /** The repository this one was forked from; `ok: false` when the provider could not say. */
  readonly forkParent: (projectPath: string) => Promise<ForkParentLookup>
  /** The open change request in this repository whose head is the given fork branch. */
  readonly findChangeRequestForForkHead: (
    projectPath: string,
    head: ForkChangeRequestHead,
  ) => Promise<ChangeRequestResult>
}
