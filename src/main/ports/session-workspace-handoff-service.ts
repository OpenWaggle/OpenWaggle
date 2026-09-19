import { Context, type Effect } from 'effect'
import * as Data from 'effect/Data'
import type { SessionOrganizationRequest } from './session-organization-repository'

export interface DeferredWorkspaceHandoff {
  readonly transfer: 'deferred-new-worktree'
  readonly workspaceId: string
  readonly projectPath: string
  readonly workingPath: string
  readonly worktreeBranch: string
  readonly sourceHead: string
  readonly snapshotRef: string
}

export interface DeferredExistingWorkspaceHandoff {
  readonly transfer: 'deferred-existing'
  readonly workspaceId: string
  readonly projectPath: string
  readonly sourceWorkingPath: string
  readonly workingPath: string
  readonly sourceHead: string
  readonly snapshotRef: string
  readonly targetSnapshotRef: string
}

export interface ReleaseSourceWorkspaceHandoff {
  readonly transfer: 'release-source'
  readonly workspaceId: string
  readonly projectPath: string
  readonly snapshotRef: string
}

export interface ReleaseExistingWorkspaceHandoffRefs {
  readonly transfer: 'release-existing-refs'
  readonly projectPath: string
  readonly snapshotRef: string
  readonly targetSnapshotRef: string
}

export type PreparedWorkspaceHandoff =
  | DeferredWorkspaceHandoff
  | DeferredExistingWorkspaceHandoff
  | ReleaseSourceWorkspaceHandoff
  | ReleaseExistingWorkspaceHandoffRefs

export class SessionWorkspaceHandoffPreparationError extends Data.TaggedError(
  'SessionWorkspaceHandoffPreparationError',
)<{
  readonly code:
    | 'workspace_snapshot_failed'
    | 'workspace_base_ref_mismatch'
    | 'workspace_target_transfer_failed'
  readonly cause: unknown
}> {}

export interface SessionWorkspaceHandoffServiceShape {
  readonly prepare: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationRequest['command'], { operation: 'handoff' }>
    }
  }) => Effect.Effect<PreparedWorkspaceHandoff | undefined, Error>
  readonly apply: (prepared: PreparedWorkspaceHandoff) => Effect.Effect<void, Error>
  readonly rollback: (prepared: PreparedWorkspaceHandoff) => Effect.Effect<void, Error>
  readonly complete: (prepared: PreparedWorkspaceHandoff, committed: boolean) => Effect.Effect<void>
}

export class SessionWorkspaceHandoffService extends Context.Tag(
  '@openwaggle/SessionWorkspaceHandoffService',
)<SessionWorkspaceHandoffService, SessionWorkspaceHandoffServiceShape>() {}
