/**
 * SessionProjectionRepository port — domain-owned interface for session read-model persistence.
 *
 * Exposes the session detail UI projection over the canonical session/node/branch tables.
 * Runtime writes still go through SessionRepository.
 */

import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type {
  PinnedSession,
  PinnedSessionMove,
  SessionDetail,
  SessionSummary,
  SessionWorktreePlan,
} from '@shared/types/session'
import type { TurnCheckpointSummary, TurnDiff } from '@shared/types/turn-diff'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'

export interface SessionProjectionRepositoryShape {
  readonly get: (id: SessionId) => Effect.Effect<SessionDetail, SessionProjectionRepositoryError>
  readonly getOptional: (
    id: SessionId,
  ) => Effect.Effect<SessionDetail | null, SessionProjectionRepositoryError>
  readonly list: (
    limit?: number,
  ) => Effect.Effect<readonly SessionSummary[], SessionProjectionRepositoryError>
  readonly listDetails: (
    limit?: number,
    offset?: number,
  ) => Effect.Effect<readonly SessionDetail[], SessionProjectionRepositoryError>
  readonly create: (input: {
    readonly projectPath: string
    readonly piSessionId: string
    readonly piSessionFile?: string
    readonly environmentMode?: SessionEnvironmentMode
    readonly authorizationMode?: AgentAuthorizationMode
  }) => Effect.Effect<SessionDetail, SessionProjectionRepositoryError>
  readonly delete: (id: SessionId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly archive: (id: SessionId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly unarchive: (id: SessionId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly listArchived: () => Effect.Effect<
    readonly SessionSummary[],
    SessionProjectionRepositoryError
  >
  readonly updateTitle: (
    id: SessionId,
    title: string,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly setWorktreePlan: (
    id: SessionId,
    plan: SessionWorktreePlan,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly setAuthorizationMode: (
    id: SessionId,
    mode: AgentAuthorizationMode,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly listTurnCheckpoints: (
    id: SessionId,
  ) => Effect.Effect<readonly TurnCheckpointSummary[], SessionProjectionRepositoryError>
  readonly getTurnDiff: (
    id: SessionId,
    turnId: string,
  ) => Effect.Effect<TurnDiff | null, SessionProjectionRepositoryError>
  readonly setTurnCheckpointAnchor: (
    id: SessionId,
    turnId: string,
    anchorNodeId: string,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  /** Every Pinned session in Manual order, archived ones included (issue #97). */
  readonly listPinnedSessions: () => Effect.Effect<
    readonly PinnedSession[],
    SessionProjectionRepositoryError
  >
  /** Pin a session, appended to the end of Manual order. Idempotent. */
  readonly pinSession: (id: SessionId) => Effect.Effect<void, SessionProjectionRepositoryError>
  /** Remove a pin. Idempotent. */
  readonly unpinSession: (id: SessionId) => Effect.Effect<void, SessionProjectionRepositoryError>
  /** Reposition one pin between two neighbours, writing only that pin. */
  readonly movePinnedSession: (
    move: PinnedSessionMove,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
}

export class SessionProjectionRepository extends Context.Tag(
  '@openwaggle/SessionProjectionRepository',
)<SessionProjectionRepository, SessionProjectionRepositoryShape>() {}
