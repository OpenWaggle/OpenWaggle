import { SessionId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'

const mocks = vi.hoisted(() => ({ searchSessionTree: vi.fn(), warn: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { searchSessionTree: mocks.searchSessionTree } }))
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { useSessionTreeTextSearch } from '../useSessionTreeTextSearch'

const SESSION_ID = SessionId('session-search')
const QUERY = 'secret deploy token'

function tree(
  input: { readonly updatedAt?: number; readonly nodeCount?: number } = {},
): SessionTree {
  return {
    session: {
      id: SESSION_ID,
      title: 'Search',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: input.updatedAt ?? 2,
    },
    nodes: Array.from({ length: input.nodeCount ?? 0 }, (_, index) =>
      node({ id: `n-${String(index)}`, depth: index, order: index }),
    ),
    branches: [],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: [], expandedNodeIdsTouched: false }),
  }
}

/*
 * PR 391 review R2 P3-6: a failed Host search became an empty match set with no trace, so
 * full-text matches vanished silently. It is logged with the Session and the error's code, never
 * the query.
 */
describe('useSessionTreeTextSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.warn.mockReset()
    mocks.searchSessionTree.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('logs a failed search without its query and matches nothing', async () => {
    const failure = Object.assign(new Error(`search failed for "${QUERY}"`), {
      code: 'session_not_found',
    })
    mocks.searchSessionTree.mockRejectedValueOnce(failure)
    const view = renderHook(() => useSessionTreeTextSearch(tree(), QUERY))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mocks.warn).toHaveBeenCalledWith('Session tree text search failed', {
      sessionId: SESSION_ID,
      errorName: 'Error',
      code: 'session_not_found',
    })
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('deploy')
    expect(view.result.current?.size).toBe(0)
  })

  /*
   * Review V2 P3-1: with a query open, every append while a Run streamed searched the whole
   * Session on the Host again. The next search carries the previous one's cursor, and the Host's
   * incremental matches are added to the ones shown, which stay shown meanwhile.
   */
  it('searches only what was appended since its last answer, keeping its matches meanwhile', async () => {
    const cursor = { throughCreatedOrder: 1, nodeMutationRevision: 4 }
    mocks.searchSessionTree
      .mockResolvedValueOnce({ nodeIds: ['n-0'], incremental: false, cursor })
      .mockResolvedValueOnce({
        nodeIds: ['n-2'],
        incremental: true,
        cursor: { throughCreatedOrder: 3, nodeMutationRevision: 4 },
      })
    const view = renderHook((current: SessionTree) => useSessionTreeTextSearch(current, 'needle'), {
      initialProps: tree({ nodeCount: 2 }),
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect([...(view.result.current ?? [])]).toEqual(['n-0'])

    view.rerender(tree({ updatedAt: 3, nodeCount: 4 }))
    expect([...(view.result.current ?? [])]).toEqual(['n-0'])
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mocks.searchSessionTree.mock.calls).toEqual([
      [SESSION_ID, 'needle'],
      [SESSION_ID, 'needle', cursor],
    ])
    expect([...(view.result.current ?? [])].sort()).toEqual(['n-0', 'n-2'])
  })

  it('replaces its matches when the Host searched everything again', async () => {
    mocks.searchSessionTree
      .mockResolvedValueOnce({
        nodeIds: ['n-0'],
        incremental: false,
        cursor: { throughCreatedOrder: 1, nodeMutationRevision: 4 },
      })
      .mockResolvedValueOnce({
        nodeIds: ['n-1'],
        incremental: false,
        cursor: { throughCreatedOrder: 1, nodeMutationRevision: 5 },
      })
    const view = renderHook((current: SessionTree) => useSessionTreeTextSearch(current, 'needle'), {
      initialProps: tree({ nodeCount: 2 }),
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    view.rerender(tree({ updatedAt: 3, nodeCount: 2 }))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect([...(view.result.current ?? [])]).toEqual(['n-1'])
  })

  it('never shows one query’s matches for another', async () => {
    mocks.searchSessionTree.mockResolvedValue({
      nodeIds: ['n-0'],
      incremental: false,
      cursor: null,
    })
    const view = renderHook((current: string) => useSessionTreeTextSearch(tree(), current), {
      initialProps: 'needle',
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    view.rerender('other')

    expect(view.result.current).toBeUndefined()
    expect(mocks.searchSessionTree).toHaveBeenCalledTimes(1)
  })
})
