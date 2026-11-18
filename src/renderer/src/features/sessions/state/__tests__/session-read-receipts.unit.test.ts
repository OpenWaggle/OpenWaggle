import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ updateSessionTreeUiState: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

import { useSessionStatusStore } from '../session-status-store'

const sessionId = SessionId('receipt-session')

describe('Session read receipt persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    apiMocks.updateSessionTreeUiState.mockResolvedValue(undefined)
    useSessionStatusStore.setState({ lastVisitedAt: new Map(), terminalReceiptRevision: 0 })
  })

  it('serializes writes to one Session and persists the latest intent last', async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    apiMocks.updateSessionTreeUiState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.spyOn(Date, 'now').mockReturnValue(5000)

    useSessionStatusStore.getState().markVisited(sessionId)
    useSessionStatusStore.getState().markUnread(sessionId)
    expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(0)
    expect(apiMocks.updateSessionTreeUiState).toHaveBeenCalledTimes(1)

    first.resolve()
    await vi.waitFor(() => expect(apiMocks.updateSessionTreeUiState).toHaveBeenCalledTimes(2))
    expect(apiMocks.updateSessionTreeUiState.mock.calls).toEqual([
      [sessionId, { lastVisitedAt: 5000 }],
      [sessionId, { lastVisitedAt: 0 }],
    ])
    second.resolve()
    await vi.waitFor(() =>
      expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(0),
    )
  })

  it('restores the hydrated receipt when a write fails', async () => {
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[sessionId, 5]]) })
    apiMocks.updateSessionTreeUiState.mockRejectedValueOnce(new Error('Host unavailable'))
    useSessionStatusStore.getState().markUnread(sessionId)
    expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(0)
    await vi.waitFor(() =>
      expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(5),
    )
  })

  it('restores absence when the first receipt write fails', async () => {
    apiMocks.updateSessionTreeUiState.mockRejectedValueOnce(new Error('Host unavailable'))
    useSessionStatusStore.getState().markVisited(sessionId)
    await vi.waitFor(() =>
      expect(useSessionStatusStore.getState().lastVisitedAt.has(sessionId)).toBe(false),
    )
  })

  it('keeps newer intent after an earlier failure and continues the queue', async () => {
    const first = Promise.withResolvers<void>()
    apiMocks.updateSessionTreeUiState.mockReturnValueOnce(first.promise)
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    useSessionStatusStore.getState().markVisited(sessionId)
    useSessionStatusStore.getState().markUnread(sessionId)

    first.reject(new Error('first write failed'))
    await vi.waitFor(() => expect(apiMocks.updateSessionTreeUiState).toHaveBeenCalledTimes(2))
    expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(0)
  })

  it('rolls back a failed latest write to the preceding confirmed receipt', async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    apiMocks.updateSessionTreeUiState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    useSessionStatusStore.getState().markVisited(sessionId)
    useSessionStatusStore.getState().markUnread(sessionId)

    first.resolve()
    await vi.waitFor(() => expect(apiMocks.updateSessionTreeUiState).toHaveBeenCalledTimes(2))
    second.reject(new Error('second write failed'))
    await vi.waitFor(() =>
      expect(useSessionStatusStore.getState().lastVisitedAt.get(sessionId)).toBe(5000),
    )
  })
})
