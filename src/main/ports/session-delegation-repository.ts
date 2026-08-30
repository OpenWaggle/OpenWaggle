import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export interface SessionDelegationRepositoryShape {
  readonly execute: (input: {
    readonly callerId: string
    readonly request: SessionControlDelegationMutationRequest
    readonly now: number
  }) => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>
}

export class SessionDelegationRepository extends Context.Tag(
  '@openwaggle/SessionDelegationRepository',
)<SessionDelegationRepository, SessionDelegationRepositoryShape>() {}
