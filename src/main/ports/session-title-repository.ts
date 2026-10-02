import type { SessionTitleSource } from '@shared/session-title-source'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionTitleRepositoryError } from '../errors'

/** What title generation needs to know about one Session. */
export interface SessionTitleState {
  readonly sessionId: SessionId
  readonly title: string
  readonly source: SessionTitleSource
  /** The first generation flagged its request as too vague, so one Title refinement is owed. */
  readonly needsRefinement: boolean
  readonly projectPath: string | null
  /** The model the Session's next Run resolves, which also anchors the Automatic Title model. */
  readonly executionModel: SupportedModelId | null
  readonly archived: boolean
  /** Workers are titled from their Delegation objective and never receive Title refinement. */
  readonly isWorker: boolean
  /** Last activity; title writes never move it, so it measures the Session's work, not its titles. */
  readonly updatedAt: number
}

/**
 * The title the caller read before generating. A write applies only when the Session still has
 * exactly this title and one of these sources, so a rename made meanwhile always wins.
 */
export interface SessionTitleExpectation {
  readonly title: string
  readonly sources: readonly SessionTitleSource[]
}

export interface SessionTitleRepositoryShape {
  readonly getState: (
    sessionId: SessionId,
  ) => Effect.Effect<SessionTitleState | null, SessionTitleRepositoryError>
  /** Applies a generated title without touching recency; false when the expectation failed. */
  readonly applyGenerated: (input: {
    readonly sessionId: SessionId
    readonly expected: SessionTitleExpectation
    readonly title: string
    readonly needsRefinement: boolean
  }) => Effect.Effect<boolean, SessionTitleRepositoryError>
  /** Settles an owed Title refinement that will not happen, so it is never retried. */
  readonly clearRefinement: (
    sessionId: SessionId,
  ) => Effect.Effect<void, SessionTitleRepositoryError>
  /** Recently active Sessions still owed a Title refinement, for recovery after a Host restart. */
  readonly listPendingRefinements: (input: {
    readonly activeAfter: number
    readonly limit: number
  }) => Effect.Effect<readonly SessionId[], SessionTitleRepositoryError>
  /** Settles refinements owed by Sessions idle since the cutoff; a refinement belongs to a start. */
  readonly settleRefinementsIdleSince: (
    activeBefore: number,
  ) => Effect.Effect<void, SessionTitleRepositoryError>
  /** Recently active Sessions still showing a Provisional title a Host restart cut off. */
  readonly listRecentProvisional: (input: {
    readonly activeAfter: number
    readonly limit: number
  }) => Effect.Effect<readonly SessionId[], SessionTitleRepositoryError>
}

export class SessionTitleRepository extends Context.Tag('@openwaggle/SessionTitleRepository')<
  SessionTitleRepository,
  SessionTitleRepositoryShape
>() {}
