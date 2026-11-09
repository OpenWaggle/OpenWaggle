import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'
import type { PreparedWorkspaceHandoff } from './session-workspace-handoff-service'

export type SessionOrganizationRequest = Omit<SessionControlMutationRequest, 'command'> & {
  readonly command: SessionOrganizationCommand
}

export interface AdmittedExistingWorkspaceHandoff {
  readonly previousWorkspaceId: string
  readonly workspaceId: string
}

export type ExistingWorkspaceHandoffAdmission =
  | { readonly status: 'admitted'; readonly handoff: AdmittedExistingWorkspaceHandoff }
  | { readonly status: 'completed'; readonly response: SessionControlMutationResponse }

/** What a deferred self-archive re-reads before it archives (see `session-self-archive.ts`). */
export interface SessionSelfArchiveState {
  readonly archived: boolean
  readonly activeRunId: string | null
  readonly queuedFollowUpCount: number
  /** The asking Run's durable status, or null when it has no `session_runs` row. */
  readonly runStatus: string | null
  /** Runs of the Session recorded after the asking Run, even ones that have already ended. */
  readonly laterRunCount: number
}

export interface SessionOrganizationRepositoryShape {
  /** Classify archive replays/rejections before interrupting any current desktop work. */
  readonly prepareArchive: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationCommand, { operation: 'archive' }>
    }
  }) => Effect.Effect<
    | { readonly status: 'ready' }
    | { readonly status: 'completed'; readonly response: SessionControlMutationResponse },
    SessionControlRepositoryError
  >
  /** The Session's state for a self-archive deferred by Run `runId`; null when it is gone. */
  readonly readSelfArchiveState: (input: {
    readonly sessionId: string
    readonly runId: string
  }) => Effect.Effect<SessionSelfArchiveState | null, SessionControlRepositoryError>
  readonly execute: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest
    readonly preparedHandoff?: PreparedWorkspaceHandoff
    readonly preparationRejectionCode?: string
  }) => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>
  readonly admitExistingHandoff: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationCommand, { operation: 'handoff' }>
    }
    readonly preparedHandoff: Extract<PreparedWorkspaceHandoff, { transfer: 'deferred-existing' }>
  }) => Effect.Effect<ExistingWorkspaceHandoffAdmission, SessionControlRepositoryError>
  readonly completeExistingHandoff: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationCommand, { operation: 'handoff' }>
    }
    readonly preparedHandoff: Extract<PreparedWorkspaceHandoff, { transfer: 'deferred-existing' }>
    readonly handoff: AdmittedExistingWorkspaceHandoff
  }) => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>
  readonly abortExistingHandoff: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationCommand, { operation: 'handoff' }>
    }
    readonly preparedHandoff: Extract<PreparedWorkspaceHandoff, { transfer: 'deferred-existing' }>
    readonly handoff: AdmittedExistingWorkspaceHandoff
    readonly targetRestored: boolean
  }) => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>
  readonly completeHandoffCleanup: (input: {
    readonly callerId: string
    readonly request: SessionOrganizationRequest & {
      readonly command: Extract<SessionOrganizationCommand, { operation: 'handoff' }>
    }
  }) => Effect.Effect<void, SessionControlRepositoryError>
}

export class SessionOrganizationRepository extends Context.Tag(
  '@openwaggle/SessionOrganizationRepository',
)<SessionOrganizationRepository, SessionOrganizationRepositoryShape>() {}
