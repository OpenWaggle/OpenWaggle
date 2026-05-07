import type { SessionId } from '@shared/types/brand'

/** Cleanup per-session runtime state owned outside the Pi session. */
export function cleanupSessionRun(sessionId: SessionId): void {
  void sessionId
}
