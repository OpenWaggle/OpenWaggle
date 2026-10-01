import type {
  SessionControlMutationOutcome,
  SessionControlMutationRequest,
} from '@shared/types/session-control'
import { Context, type Effect } from 'effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import type { SessionControlRepositoryError } from '../errors'

export type SessionControlMutationDecision =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: SessionControlMutationOutcome
    }
  | {
      readonly accepted: false
      readonly outcome: SessionControlMutationOutcome
    }

export interface ExecuteSessionControlMutationInput {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly hostRunCeiling?: number
  readonly decide: (state: SessionControlSessionState) => SessionControlMutationDecision
  /**
   * Decides again when `decide` would start a Run the Host does not admit. Without it the mutation
   * is rejected with the admission code. A decision that still starts a Run is rejected too.
   */
  readonly decideWithoutNewRun?: (
    state: SessionControlSessionState,
    refusal: SessionControlRunAdmissionRefusal,
  ) => SessionControlMutationDecision
}

export type SessionControlRunAdmissionRefusal =
  | 'parent_concurrency_limit_reached'
  | 'host_run_ceiling_reached'

export interface ExecuteSessionControlMutationResult {
  readonly replayed: boolean
  readonly outcome: SessionControlMutationOutcome
}

export interface SessionControlRepositoryShape {
  readonly executeMutation: (
    input: ExecuteSessionControlMutationInput,
  ) => Effect.Effect<ExecuteSessionControlMutationResult, SessionControlRepositoryError>
}

export class SessionControlRepository extends Context.Tag('@openwaggle/SessionControlRepository')<
  SessionControlRepository,
  SessionControlRepositoryShape
>() {}
