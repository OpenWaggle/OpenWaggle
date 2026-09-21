import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { SessionQueryRequest } from '@shared/types/session-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { SidebarRowState } from '../../lib/sidebar-row-state'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'
import { hookInput, listResponse, summary } from './useRemoteSidebarSessions.test-support'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const interrupted = [
  summary('stuck-alpha', 'Stuck session in alpha', '/repo/alpha'),
  summary('stuck-beta', 'Stuck session in beta', '/repo/beta'),
]
const calm = summary('calm-alpha', 'Calm session in alpha', '/repo/alpha')
const rowStates = new Map<string, SidebarRowState>([
  ['stuck-alpha', 'interrupted'],
  ['stuck-beta', 'interrupted'],
  ['calm-alpha', 'idle'],
])

function mockInterruptedPage(sessions: readonly SessionSummary[] = interrupted) {
  apiMocks.querySessionControl.mockImplementation(async (request: SessionQueryRequest) =>
    request.query.operation === 'list' && request.query.interrupted === true
      ? listResponse(sessions, { totalCount: sessions.length })
      : listResponse([], { totalCount: 0 }),
  )
  apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
    sessions.filter((session) => ids.includes(session.id)),
  )
}

describe('interrupted Session text filtering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSessionStatusStore.setState(useSessionStatusStore.getInitialState())
    mockInterruptedPage()
  })

  it('combines the state chip with text, then restores every row when both filters clear', async () => {
    const { result, rerender } = renderHook(
      ({ query, filterState }: { query: string; filterState: SidebarRowState | null }) =>
        useRemoteSidebarSessions(
          hookInput({
            query,
            filterState,
            loadedSessions: [...interrupted, calm],
            stateBySessionId: rowStates,
          }),
        ),
      { initialProps: { query: '', filterState: 'interrupted' } },
    )
    await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledOnce())
    expect(result.current.sessions).toEqual(interrupted)

    await act(async () => rerender({ query: 'Calm', filterState: 'interrupted' }))
    await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(2))
    expect(result.current.sessions).toEqual([])

    await act(async () => rerender({ query: '', filterState: null }))
    expect(result.current.sessions).toEqual([...interrupted, calm])
  })

  it.each([
    { query: '  STUCK SESSION IN ALPHA  ', expectedId: 'stuck-alpha' },
    { query: 'alpha', expectedId: 'stuck-alpha' },
    { query: 'Team Beta', expectedId: 'stuck-beta' },
  ])(
    'matches hydrated Sessions by title, project name, or alias: $query',
    async ({ query, expectedId }) => {
      const { result } = renderHook(() =>
        useRemoteSidebarSessions(
          hookInput({
            query,
            filterState: 'interrupted',
            projectDisplayNames: { '/repo/beta': 'Team Beta' },
          }),
        ),
      )

      await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledOnce())
      expect(result.current.sessions.map((session) => String(session.id))).toEqual([expectedId])
    },
  )

  it('does not restore a Session archived between discovery and hydration', async () => {
    const archived = { ...summary('archived-stuck', 'Archived interruption'), archived: true }
    mockInterruptedPage([archived])
    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ filterState: 'interrupted' })),
    )

    await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledOnce())
    expect(result.current.sessions).toEqual([])
  })

  it('keeps pagination available when the first interrupted page has no text match', async () => {
    apiMocks.querySessionControl.mockImplementation(async (request: SessionQueryRequest) => {
      if (request.query.operation !== 'list' || request.query.interrupted !== true) {
        return listResponse([], { totalCount: 0 })
      }
      return request.query.cursor
        ? listResponse(interrupted.slice(1))
        : listResponse(interrupted.slice(0, 1), { nextCursor: 'interrupted-page-2' })
    })
    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ filterState: 'interrupted', query: 'beta' })),
    )

    await waitFor(() => expect(result.current.hasMore).toBe(true))
    expect(result.current.sessions).toEqual([])
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.hasMore).toBe(false))
    expect(result.current.sessions).toEqual(interrupted.slice(1))
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(2)
  })
})
