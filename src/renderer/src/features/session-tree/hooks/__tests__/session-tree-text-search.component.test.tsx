import { SessionId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'

const mocks = vi.hoisted(() => ({ searchSessionTree: vi.fn(), warn: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { searchSessionTree: mocks.searchSessionTree } }))
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { useSessionTreeTextSearch } from '../useSessionTreeTextSearch'

const SESSION_ID = SessionId('session-search')
const QUERY = 'secret deploy token'

function tree(): SessionTree {
  return {
    session: { id: SESSION_ID, title: 'Search', projectPath: '/repo', createdAt: 1, updatedAt: 2 },
    nodes: [],
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
})
