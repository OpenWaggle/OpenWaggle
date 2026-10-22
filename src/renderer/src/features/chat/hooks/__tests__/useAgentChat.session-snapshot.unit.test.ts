import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionDetail } = vi.hoisted(() => ({ getSessionDetail: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionDetail } }))

const { createSessionSnapshotRefresh } = await import('../useAgentChat.session-snapshot')

const SESSION = SessionId('session-shown')

function refreshFor(shown: SessionDetail | null) {
  const upsertSession = vi.fn()
  const refresh = createSessionSnapshotRefresh({
    currentSessionIdRef: { current: SESSION },
    sessionRef: { current: shown },
    upsertSession,
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

  it('keeps the transcript shown when the Host connection closed mid-read', async () => {
    getSessionDetail.mockRejectedValue(
      new Error(
        "Error invoking remote method 'sessions:get-detail': LocalSessionHostConnectionClosedError: Local Session Host connection closed.",
      ),
    )
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 1 }))

    await expect(refresh(SESSION)).resolves.toBeUndefined()
    expect(upsertSession).not.toHaveBeenCalled()
  })

  it('drops a reply older than the Session shown', async () => {
    getSessionDetail.mockResolvedValue(fromPartial<SessionDetail>({ id: SESSION, updatedAt: 1 }))
    const { refresh, upsertSession } = refreshFor(fromPartial({ id: SESSION, updatedAt: 2 }))

    await refresh(SESSION)

    expect(upsertSession).not.toHaveBeenCalled()
  })
})
