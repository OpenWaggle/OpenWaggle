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
}

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
