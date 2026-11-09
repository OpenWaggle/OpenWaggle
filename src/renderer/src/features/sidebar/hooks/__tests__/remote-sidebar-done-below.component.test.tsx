import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { SidebarRowState } from '../../lib/sidebar-row-state'
import { useRemoteSidebarRowStates } from '../remote-sidebar-row-states'
import { mergeVisibleSidebarSessions } from '../remote-sidebar-session-results'
import { pruneHydratedTerminalIds } from '../remote-sidebar-terminal-status'

const initialStatus = useSessionStatusStore.getState()

afterEach(() => {
  useSessionStatusStore.setState(initialStatus, true)
})

/** A Queen whose own Run completed at 1 and was seen at 2; her last Worker Run ended at 3. */
function queen(): SessionSummary {
  return {
    id: SessionId('queen'),
    title: 'Queen',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt: 3,
    lineage: { role: 'queen', directWorkerCount: 1, workersLastRunEndedAt: 3 },
  }
}

describe('remote sidebar filters with Done below parents (ADR 0063)', () => {
  it('keeps a Host-listed Done parent that is not loaded, whose own Run was seen', () => {
    useSessionStatusStore.getState().setStatus(SessionId('queen'), 'completed', 1)
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[SessionId('queen'), 2]]) })
    const shared = new Map<string, SidebarRowState>([['queen', 'idle']])
    const { result } = renderHook(() =>
      useRemoteSidebarRowStates({
        stateBySessionId: shared,
        loadedSessions: [],
        remoteSessions: [queen()],
      }),
    )
    expect(result.current.get('queen')).toBe('completed')
    const merged = mergeVisibleSidebarSessions({
      loadedSessions: [],
      remoteSessions: [queen()],
      filterState: 'completed',
      stateBySessionId: result.current,
      normalizedQuery: '',
      projectDisplayNames: {},
    })
    expect(merged.map((session) => session.id)).toEqual(['queen'])
  })

  it('lets a visit clear Done below on a parent that is not loaded', () => {
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[SessionId('queen'), 4]]) })
    const { result } = renderHook(() =>
      useRemoteSidebarRowStates({
        stateBySessionId: new Map(),
        loadedSessions: [],
        remoteSessions: [queen()],
      }),
    )
    expect(result.current.get('queen')).toBe('idle')
  })

  it('keeps a hydrated id the row shows even when its raw status differs', () => {
    const hydrated = { completed: new Set(['queen', 'seen', 'gone']), error: new Set<string>() }
    pruneHydratedTerminalIds(
      hydrated,
      new Map([
        [SessionId('queen'), 'error' as const],
        [SessionId('seen'), 'completed' as const],
      ]),
      new Map<string, SidebarRowState>([
        ['queen', 'completed'],
        ['seen', 'idle'],
      ]),
    )
    expect([...hydrated.completed]).toEqual(['queen', 'seen'])
  })
})
