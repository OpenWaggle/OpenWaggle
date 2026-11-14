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
function queen() {
  return {
    id: SessionId('queen'),
    title: 'Queen',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt: 3,
    lineage: {
      role: 'queen',
      directWorkerCount: 1,
      activeDirectWorkerCount: 0,
      workersLastRunEndedAt: 3,
    },
  } satisfies SessionSummary
}

describe('remote sidebar filters with Done below parents (ADR 0065)', () => {
  it('keeps a Host-listed Done parent that is not loaded, whose own Run was seen', () => {
    useSessionStatusStore.getState().setStatus(SessionId('queen'), 'completed', 1)
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[SessionId('queen'), 2]]) })
    const shared = new Map<string, SidebarRowState>([['queen', 'idle']])
    const { result } = renderHook(() =>
      useRemoteSidebarRowStates({
        hydratedTerminalIds: { completed: new Set(), error: new Set() },
        setHydratedTerminalIds: () => undefined,
        stateBySessionId: shared,
        loadedSessions: [],
        remoteSessions: [queen()],
      }),
    )
    expect(result.current.stateBySessionId.get('queen')).toBe('completed')
    const merged = mergeVisibleSidebarSessions({
      loadedSessions: [],
      remoteSessions: [queen()],
      filterState: 'completed',
      stateBySessionId: result.current.stateBySessionId,
      normalizedQuery: '',
      projectDisplayNames: {},
    })
    expect(merged.map((session) => session.id)).toEqual(['queen'])
  })

  it('lets a visit clear Done below on a parent that is not loaded', () => {
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[SessionId('queen'), 4]]) })
    const { result } = renderHook(() =>
      useRemoteSidebarRowStates({
        hydratedTerminalIds: { completed: new Set(), error: new Set() },
        setHydratedTerminalIds: () => undefined,
        stateBySessionId: new Map(),
        loadedSessions: [],
        remoteSessions: [queen()],
      }),
    )
    expect(result.current.stateBySessionId.get('queen')).toBe('idle')
  })

  it('shows the loaded catalog entry, which follows Worker Runs, over a search copy', () => {
    const withRunning = (runningWorkerCount: number) => {
      const base = queen()
      if (!base.lineage) throw new Error('Expected a Queen lineage.')
      return { ...base, lineage: { ...base.lineage, runningWorkerCount } } satisfies SessionSummary
    }
    const searched = withRunning(2)
    const loaded = withRunning(0)
    const merged = mergeVisibleSidebarSessions({
      loadedSessions: [loaded],
      remoteSessions: [searched],
      filterState: null,
      stateBySessionId: new Map(),
      normalizedQuery: 'zzz',
      projectDisplayNames: {},
    })
    expect(merged).toEqual([loaded])
  })

  it('keeps a hydrated id the row shows even when its raw status differs', () => {
    const hydrated = {
      completed: new Set(['queen', 'seen', 'gone', 'later']),
      error: new Set<string>(),
    }
    const pruned = pruneHydratedTerminalIds(
      hydrated,
      new Map([
        [SessionId('queen'), 'error' as const],
        [SessionId('seen'), 'completed' as const],
      ]),
      new Map<string, SidebarRowState>([
        ['queen', 'completed'],
        ['seen', 'idle'],
        ['gone', 'idle'],
        ['later', 'idle'],
      ]),
      new Set(['queen', 'seen', 'gone']),
    )
    // `later` was loaded after the states were resolved, so its idle state is not trusted yet.
    expect([...pruned.completed]).toEqual(['queen', 'seen', 'later'])
    // A new object, so what the React Compiler caches on it is recomputed.
    expect(pruned).not.toBe(hydrated)
    expect([...hydrated.completed]).toEqual(['queen', 'seen', 'gone', 'later'])
  })

  it('forgets a hydrated id that left the pages once it starts a new Run', () => {
    const hydrated = { completed: new Set(['rerun', 'resting']), error: new Set<string>() }
    const pruned = pruneHydratedTerminalIds(
      hydrated,
      new Map([
        [SessionId('rerun'), 'working' as const],
        [SessionId('resting'), 'error' as const],
      ]),
      new Map<string, SidebarRowState>([
        ['rerun', 'working'],
        ['resting', 'idle'],
      ]),
      new Set(),
    )
    expect([...pruned.completed]).toEqual(['resting'])
    expect(pruneHydratedTerminalIds(pruned, new Map(), new Map(), new Set())).toBe(pruned)
  })
})
