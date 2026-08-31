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

export interface SessionOrganizationRepositoryShape {
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
