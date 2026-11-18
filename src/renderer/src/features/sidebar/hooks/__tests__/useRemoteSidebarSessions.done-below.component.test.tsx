import { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'
import { useSidebarRowStates } from '../useSidebarRowStates'
import { hookInput, listResponse, summary } from './useRemoteSidebarSessions.test-support'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(apiMocks),
}))

describe('remote Completed filter with a Done below parent (ADR 0065)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  it('keeps the cursor when a page brings a parent whose own seen Run failed', async () => {
    const other = {
      ...summary('other', 'Other'),
      latestRun: { status: 'completed' as const, updatedAt: 5 },
    }
    // Her own Run failed at 10 and was seen at 20; her last Worker Run ended at 30.
    const queen = {
      ...summary('queen', 'Queen'),
      latestRun: { status: 'failed' as const, updatedAt: 10 },
      treeUiState: {
        sessionId: SessionId('queen'),
        expandedNodeIds: [],
        expandedNodeIdsTouched: false,
        branchesSidebarCollapsed: false,
        lastVisitedAt: 20,
        updatedAt: 20,
      },
      lineage: {
        role: 'queen' as const,
        directWorkerCount: 1,
        activeDirectWorkerCount: 0,
        workersLastRunEndedAt: 30,
      },
    }
    const remote = [other, queen]
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.unreadTerminalStatus !== 'completed') {
        return listResponse([], { totalCount: 0 })
      }
      if (request.query.limit === 1) return listResponse([], { totalCount: 2 })
      return request.query.cursor === 'page-2'
        ? listResponse([queen])
        : listResponse([other], { nextCursor: 'page-2' })
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() => {
      const rowStates = useSidebarRowStates([], 0)
      return useRemoteSidebarSessions(
        hookInput({ filterState: 'completed', stateBySessionId: rowStates.stateBySessionId }),
      )
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    act(() => result.current.loadMore())
    await waitFor(() =>
      expect(result.current.sessions.map((session) => session.id)).toEqual(['other', 'queen']),
    )
    // Give a wrongly pruned id the chance to rewind the list.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current.sessions.map((session) => session.id)).toEqual(['other', 'queen'])
    const cursors = apiMocks.querySessionControl.mock.calls
      .filter(
        ([request]) =>
          request.query.unreadTerminalStatus === 'completed' && request.query.limit !== 1,
      )
      .map(([request]) => request.query.cursor)
    expect(cursors).toEqual([undefined, 'page-2'])
  })
})
