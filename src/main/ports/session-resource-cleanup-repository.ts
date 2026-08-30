import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionResourceRepositoryError } from '../errors'

export interface SessionResourceCleanupRepositoryShape {
  readonly listPending: (
    limit: number,
  ) => Effect.Effect<readonly SessionId[], SessionResourceRepositoryError>
  readonly complete: (sessionId: SessionId) => Effect.Effect<void, SessionResourceRepositoryError>
}

export class SessionResourceCleanupRepository extends Context.Tag(
  '@openwaggle/SessionResourceCleanupRepository',
)<SessionResourceCleanupRepository, SessionResourceCleanupRepositoryShape>() {}
