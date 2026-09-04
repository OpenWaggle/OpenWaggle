import type {
  ChangeRequestResult,
  GitCommitResult,
  GitStackedActionProbeFailure,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
} from '@shared/types/git'
import type { GitPullResult, GitPushResult } from './push-service'

/** Git capabilities injected into the stacked-action workflow. */
export interface StackedActionDeps {
  /** A read failure stays distinct from a clean working tree. */
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
  /** Current checked-out branch when no feature branch was created. */
  readonly resolveCurrentRef: (projectPath: string) => Promise<string | null>
  readonly resolveDefaultBaseRef: (projectPath: string) => Promise<string | null>
  /** Repository that will receive the change request. */
  readonly resolvePrimaryRemoteUrl: (projectPath: string) => Promise<string | null>
  /** This read-only check must precede every mutating PR or MR phase. */
  readonly preflightChangeRequest: (projectPath: string) => Promise<SourceControlAuthResult>
  readonly buildChangeRequestFallbackUrl: (
    projectPath: string,
    payload: OpenChangeRequestPayload,
    headRefAvailableRemotely: boolean,
  ) => Promise<string | null>
}
