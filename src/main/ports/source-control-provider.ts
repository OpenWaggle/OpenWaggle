import type {
  ChangeRequestCheckoutResult,
  ChangeRequestListResult,
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlProviderId,
} from '@shared/types/git'

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
  /**
   * Check a change request out into the working tree at `projectPath` (used to
   * seed a Session worktree). `reference` is a number, URL, or branch name.
   */
  readonly checkoutChangeRequest: (
    projectPath: string,
    reference: string,
  ) => Promise<ChangeRequestCheckoutResult>
}
