import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionDetail } = vi.hoisted(() => ({ getSessionDetail: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionDetail } }))

const { createSessionSnapshotRefresh } = await import('../useAgentChat.session-snapshot')

const SESSION = SessionId('session-shown')

function connectionClosed() {
  return new Error(
    "Error invoking remote method 'sessions:get-detail': LocalSessionHostConnectionClosedError: Local Session Host connection closed.",
  )
}

function refreshFor(shown: SessionDetail | null) {
  const upsertSession = vi.fn()
  const refresh = createSessionSnapshotRefresh({
    currentSessionIdRef: { current: SESSION },
    sessionRef: { current: shown },
    upsertSession,
    retryDelayMs: 0,
  })
  return { refresh, upsertSession }
}

describe('createSessionSnapshotRefresh', () => {
  beforeEach(() => {
    // A function beforeEach returns is run as its teardown, so the mock must not be returned.
    getSessionDetail.mockReset()
  })

  it('shows the Session the Host answers with', async () => {
    const next = fromPartial<SessionDetail>({ id: SESSION, updatedAt: 2 })
    getSessionDetail.mockResolvedValue(next)
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 1 }))

    await refresh(SESSION)

    expect(upsertSession).toHaveBeenCalledWith(next)
  })

  it('reads again when the Host connection closed mid-read', async () => {
    const next = fromPartial<SessionDetail>({ id: SESSION, updatedAt: 2 })
    getSessionDetail.mockRejectedValueOnce(connectionClosed()).mockResolvedValueOnce(next)
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 1 }))

    await refresh(SESSION)

    expect(getSessionDetail).toHaveBeenCalledTimes(2)
    expect(upsertSession).toHaveBeenCalledWith(next)
  })

  it('keeps the transcript shown when the read fails twice', async () => {
    getSessionDetail.mockRejectedValue(connectionClosed())
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 1 }))

    await expect(refresh(SESSION)).resolves.toBeUndefined()
    expect(getSessionDetail).toHaveBeenCalledTimes(2)
    expect(upsertSession).not.toHaveBeenCalled()
  })

  it('does not read again once another Session is shown', async () => {
    getSessionDetail.mockRejectedValue(connectionClosed())
    const currentSessionIdRef: { current: SessionId | null } = { current: SESSION }
    const upsertSession = vi.fn()
    const refresh = createSessionSnapshotRefresh({
      currentSessionIdRef,
      sessionRef: { current: fromPartial({ id: SESSION, updatedAt: 1 }) },
      upsertSession,
      retryDelayMs: 10,
    })

    const refreshing = refresh(SESSION)
    currentSessionIdRef.current = SessionId('session-other')
    await refreshing

    expect(getSessionDetail).toHaveBeenCalledTimes(1)
    expect(upsertSession).not.toHaveBeenCalled()
  })

  it('drops a reply older than the Session shown', async () => {
    getSessionDetail.mockResolvedValue(fromPartial<SessionDetail>({ id: SESSION, updatedAt: 1 }))
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 2 }))

    await refresh(SESSION)

    expect(upsertSession).not.toHaveBeenCalled()
  })
})
