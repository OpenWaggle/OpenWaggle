import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { MutableValueRef } from './useAgentChat.types'

const logger = createRendererLogger('agent-run-controls')

interface SessionSnapshotRefreshInput {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly sessionRef: MutableValueRef<SessionDetail | null>
  readonly upsertSession: (session: SessionDetail) => void
}

/**
 * Reads the Session again after a Run and shows it while it is still the one on screen. Callers
 * do not await the refresh, so a Host that cannot answer (its connection being re-established)
 * leaves the transcript shown as it is instead of raising an unhandled rejection; the next
 * settlement reads it again.
 */
export function createSessionSnapshotRefresh(input: SessionSnapshotRefreshInput) {
  return async function refreshSessionSnapshot(targetSessionId: SessionId) {
    let nextSession: SessionDetail | null
    try {
      nextSession = await api.getSessionDetail(targetSessionId)
    } catch (error) {
      logger.warn('Could not refresh the Session after its Run', { error: String(error) })
      return
    }
    const shown = input.sessionRef.current
    if (!nextSession || input.currentSessionIdRef.current !== targetSessionId) return
    // A slow reply landing after a newer refetch hid the Runs that one held.
    if (shown?.id === nextSession.id && nextSession.updatedAt < shown.updatedAt) return
    input.upsertSession(nextSession)
  }
}
