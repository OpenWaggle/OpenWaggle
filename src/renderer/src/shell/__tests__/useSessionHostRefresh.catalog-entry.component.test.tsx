import { SessionId } from '@shared/types/brand'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLD_IMPORT_TIMEOUT_MS } from '@/test-utils/cold-import'

const { onSessionHostEvent } = vi.hoisted(() => ({
  onSessionHostEvent: vi.fn<(callback: (event: SessionHostEventEnvelope) => void) => () => void>(),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onSessionHostEvent,
    onSessionTitleUpdated: () => () => {},
    onSessionHostResyncRequired: () => () => {},
  },
}))

let useSessionHostRefresh: typeof import('../useSessionHostRefresh').useSessionHostRefresh

beforeAll(async () => {
  ;({ useSessionHostRefresh } = await import('../useSessionHostRefresh'))
}, COLD_IMPORT_TIMEOUT_MS)

const ACTIVE = SessionId('session-active')

function listChanged(sequence: number, catalogOnly?: true): SessionHostEventEnvelope {
  return {
    cursor: { hostInstanceId: 'host', sequence },
    timestamp: 1,
    payload: {
      kind: 'session-list-changed',
      sessionId: String(ACTIVE),
      change: 'updated',
      ...(catalogOnly ? { catalogOnly } : {}),
    },
  }
}

function renderRefresh() {
  const lifecycle = {
    refreshCatalogSessions: vi.fn(async () => {}),
    refreshSession: vi.fn(async () => {}),
    refreshSessionTree: vi.fn(async () => {}),
  }
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { readonly children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  renderHook(
    () =>
      useSessionHostRefresh({
        activeSessionId: ACTIVE,
        loadChatSessions: async () => {},
        loadSessionTrees: async () => {},
        updateSessionTitle: () => {},
        ...lifecycle,
      }),
    { wrapper },
  )
  const receive = onSessionHostEvent.mock.calls.at(-1)?.[0]
  if (!receive) throw new Error('Host subscription missing')
  return { lifecycle, receive, queryClient }
}

describe('useSessionHostRefresh: a change to a Session’s catalog entry alone', () => {
  beforeEach(() => {
    onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
  })

  it('refreshes the entry without reading the open Session again (its read receipt)', async () => {
    const { lifecycle, receive, queryClient } = renderRefresh()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      receive(listChanged(1, true))
    })

    expect(lifecycle.refreshCatalogSessions).toHaveBeenCalledWith([ACTIVE])
    expect(lifecycle.refreshSession).not.toHaveBeenCalled()
    expect(lifecycle.refreshSessionTree).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('still reads the open Session for any other change', async () => {
    const { lifecycle, receive } = renderRefresh()

    await act(async () => {
      receive(listChanged(1, true))
      receive(listChanged(2))
    })

    expect(lifecycle.refreshSession).toHaveBeenCalledWith(ACTIVE)
    expect(lifecycle.refreshSessionTree).toHaveBeenCalledWith(ACTIVE)
    expect(lifecycle.refreshCatalogSessions).toHaveBeenCalledOnce()
  })
})
