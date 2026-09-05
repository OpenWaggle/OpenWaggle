import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'
import { hookInput, listResponse, summary } from './useRemoteSidebarSessions.test-support'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

describe('remote sidebar Session search timing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    apiMocks.querySessionControl.mockImplementation(async () => listResponse([]))
    apiMocks.listSessionsByIds.mockResolvedValue([])
  })

  it('filters short text locally without launching an unindexed Host scan', async () => {
    const local = summary('loaded-short-match', 'Hive planner')
    const { result, rerender } = renderHook(
      ({ query }) =>
        useRemoteSidebarSessions(
          hookInput({
            query,
            loadedSessions: [local],
          }),
        ),
      { initialProps: { query: 'hi' } },
    )

    expect(result.current.sessions).toEqual([local])
    await new Promise((resolve) => window.setTimeout(resolve, 200))
    expect(
      apiMocks.querySessionControl.mock.calls.some(
        ([request]) => request.query.searchText === 'hi',
      ),
    ).toBe(false)

    rerender({ query: 'hiv' })
    await waitFor(() =>
      expect(
        apiMocks.querySessionControl.mock.calls.some(
          ([request]) => request.query.searchText === 'hiv',
        ),
      ).toBe(true),
    )
  })

  it('debounces rapid indexed searches to the latest query', async () => {
    const { rerender } = renderHook(({ query }) => useRemoteSidebarSessions(hookInput({ query })), {
      initialProps: { query: 'hiv' },
    })

    rerender({ query: 'hive' })
    rerender({ query: 'hives' })

    await waitFor(() =>
      expect(
        apiMocks.querySessionControl.mock.calls.filter(
          ([request]) => request.query.searchText !== undefined,
        ),
      ).toHaveLength(1),
    )
    expect(
      apiMocks.querySessionControl.mock.calls.find(
        ([request]) => request.query.searchText !== undefined,
      )?.[0].query.searchText,
    ).toBe('hives')
  })
})
