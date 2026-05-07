/**
 * SessionProjectionRepository port — domain-owned interface for session read-model persistence.
 *
 * Exposes the session detail UI projection over the canonical session/node/branch tables.
 * Runtime writes still go through SessionRepository.
 */
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
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
  ) => Effect.Effect<readonly SessionDetail[], SessionProjectionRepositoryError>
  readonly create: (input: {
    readonly projectPath: string
    readonly piSessionId: string
    readonly piSessionFile?: string
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
}

export class SessionProjectionRepository extends Context.Tag(
  '@openwaggle/SessionProjectionRepository',
)<SessionProjectionRepository, SessionProjectionRepositoryShape>() {}
