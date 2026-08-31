import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionResourceRepositoryError } from '../errors'

export interface SessionResourceCleanupCursor {
  readonly queuedAt: number
  readonly sessionId: SessionId
}

export interface SessionResourceCleanupRepositoryShape {
  readonly listPending: (
    limit: number,
    after?: SessionResourceCleanupCursor,
  ) => Effect.Effect<readonly SessionResourceCleanupCursor[], SessionResourceRepositoryError>
  readonly complete: (sessionId: SessionId) => Effect.Effect<void, SessionResourceRepositoryError>
}

export class SessionResourceCleanupRepository extends Context.Tag(
  '@openwaggle/SessionResourceCleanupRepository',
)<SessionResourceCleanupRepository, SessionResourceCleanupRepositoryShape>() {}
