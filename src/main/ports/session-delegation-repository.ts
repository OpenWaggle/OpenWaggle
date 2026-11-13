import type { DelegationState } from '@shared/types/session-collaboration'
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
  /** The Delegation state of a Worker Session; null for a Session that is not a Worker. */
  readonly delegationStateOf: (
    sessionId: string,
  ) => Effect.Effect<DelegationState | null, SessionControlRepositoryError>
  /**
   * Why `callerId` may not send the Worker `sessionId` a message that starts a Run, checked as
   * Follow-up delivery checks a queued Follow-up's caller, or undefined when it may. A revision
   * request reaches its Worker as the reviewer's Follow-up only when it may. Optional so test
   * doubles that never review keep compiling; absent, no revision request reaches a Worker.
   */
  readonly messageBlockReason?: (input: {
    readonly sessionId: string
    readonly callerId: string
  }) => Effect.Effect<string | undefined, SessionControlRepositoryError>
}

export class SessionDelegationRepository extends Context.Tag(
  '@openwaggle/SessionDelegationRepository',
)<SessionDelegationRepository, SessionDelegationRepositoryShape>() {}
