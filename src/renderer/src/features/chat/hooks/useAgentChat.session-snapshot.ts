import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { MutableValueRef } from './useAgentChat.types'

const logger = createRendererLogger('agent-run-controls')
/** Each read opens a new Host connection; a second one a moment later usually gets through. */
const SNAPSHOT_RETRY_DELAY_MS = 2_000

interface SessionSnapshotRefreshInput {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly sessionRef: MutableValueRef<SessionDetail | null>
  readonly upsertSession: (session: SessionDetail) => void
  readonly retryDelayMs?: number
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Reads the Session again after a Run and shows it while it is still the one on screen. Callers
 * do not await the refresh, so a Host that cannot answer (its connection being re-established)
 * must not raise an unhandled rejection: the read is tried once more after a short delay, and if
 * that fails too the transcript shown stays as it is until the Session is read again.
 */
export function createSessionSnapshotRefresh(input: SessionSnapshotRefreshInput) {
  const retryDelayMs = input.retryDelayMs ?? SNAPSHOT_RETRY_DELAY_MS

  async function read(targetSessionId: SessionId): Promise<SessionDetail | null | undefined> {
    try {
      return await api.getSessionDetail(targetSessionId)
    } catch (error) {
      logger.warn('Could not refresh the Session after its Run; trying again', {
        error: String(error),
      })
    }
    await delay(retryDelayMs)
    if (input.currentSessionIdRef.current !== targetSessionId) return undefined
    try {
      return await api.getSessionDetail(targetSessionId)
    } catch (error) {
      logger.warn('Could not refresh the Session after its Run', { error: String(error) })
      return undefined
    }
  }

  return async function refreshSessionSnapshot(targetSessionId: SessionId) {
    const nextSession = await read(targetSessionId)
    const shown = input.sessionRef.current
    if (!nextSession || input.currentSessionIdRef.current !== targetSessionId) return
    // A slow reply landing after a newer refetch hid the Runs that one held.
    if (shown?.id === nextSession.id && nextSession.updatedAt < shown.updatedAt) return
    input.upsertSession(nextSession)
  }
}
