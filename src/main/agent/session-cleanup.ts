import type { SessionId } from '@shared/types/brand'
import { clearSessionGrants } from '../application/agent-authorization-grants'

/**
 * Cleanup per-session runtime state owned outside the Pi session.
 *
 * Session-scoped authorization grants are in-memory and keyed by session id, so a deleted session
 * would otherwise leave its grants behind for the lifetime of the process. Ids are not reused, so
 * nothing could read them again, but a grant that outlives the thing it was scoped to is exactly
 * what "this session only" promises not to do.
 */
export function cleanupSessionRun(sessionId: SessionId): void {
  clearSessionGrants(sessionId)
}
