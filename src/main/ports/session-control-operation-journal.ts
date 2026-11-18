import type {
  SessionControlMutationOutcome,
  SessionControlMutationRequest,
} from '@shared/types/session-control'
import { Context, type Effect } from 'effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import type { SessionControlRepositoryError } from '../errors'

export type SessionControlExternalMutationDecision =
  | {
      readonly accepted: true
      readonly state?: SessionControlSessionState
    }
  | {
      readonly accepted: false
      readonly outcome: SessionControlMutationOutcome
    }

export interface ClaimSessionControlOperationInput {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly decide: (state: SessionControlSessionState) => SessionControlExternalMutationDecision
}

export type ClaimSessionControlOperationResult =
  | { readonly status: 'claimed'; readonly stateRevision: number }
  | { readonly status: 'pending'; readonly replayed: true }
  | {
      readonly status: 'completed'
      readonly replayed: boolean
      readonly outcome: SessionControlMutationOutcome
    }

export interface CompleteSessionControlOperationInput {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly outcome: SessionControlMutationOutcome
  readonly finalizeState?: (state: SessionControlSessionState) => SessionControlSessionState
  /**
   * Derive the stored outcome from the state `finalizeState` produced, for an outcome that reports
   * that state (its revision). Other operations may change the state between claim and completion,
   * so a revision computed at claim time can be stale. Ignored without `finalizeState`.
   */
  readonly outcomeForFinalState?: (
    finalState: SessionControlSessionState,
  ) => SessionControlMutationOutcome
}

export interface SessionControlOperationJournalShape {
  readonly claim: (
    input: ClaimSessionControlOperationInput,
  ) => Effect.Effect<ClaimSessionControlOperationResult, SessionControlRepositoryError>
  /** Resolves with the outcome the journal recorded for the operation. */
  readonly complete: (
    input: CompleteSessionControlOperationInput,
  ) => Effect.Effect<SessionControlMutationOutcome, SessionControlRepositoryError>
}

export class SessionControlOperationJournal extends Context.Tag(
  '@openwaggle/SessionControlOperationJournal',
)<SessionControlOperationJournal, SessionControlOperationJournalShape>() {}
