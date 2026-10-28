import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { QueryClient, QueryClientProvider, queryOptions, useQueries } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { COLD_IMPORT_TIMEOUT_MS } from '@/test-utils/cold-import'

const { onSessionHostEvent, manageProjectActions } = vi.hoisted(() => ({
  onSessionHostEvent: vi.fn<(callback: (event: SessionHostEventEnvelope) => void) => () => void>(),
  manageProjectActions: vi.fn(async (_key: readonly unknown[]) => ({})),
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
const WORKERS = ['worker-1', 'worker-2', 'worker-3'].map(SessionId)

function summary(id: SessionId, projectPath: string): SessionSummary {
  return { id, title: String(id), projectPath, createdAt: 1, updatedAt: 1 }
}

let sequence = 0
function stateChanged(sessionId: SessionId): SessionHostEventEnvelope {
  sequence += 1
  return {
    cursor: { hostInstanceId: 'host', sequence },
    timestamp: 1,
    payload: {
      kind: 'session-state-changed',
      sessionId: String(sessionId),
      stateRevision: sequence,
      operation: 'run-started',
    },
  }
}

/** The Project Actions queries a window with the active Session's project open keeps mounted. */
const MOUNTED_KEYS = [
  ['native-actions', '/active-project', String(ACTIVE), 'catalog'],
  ['native-actions', '/active-project', String(ACTIVE), 'runs'],
  ['native-actions', '/active-project', String(ACTIVE), 'discovery'],
  [
    'native-actions',
    '/active-project',
    { projectPath: '/active-project' },
    'shortcut-presentation',
  ],
  ['native-actions', '/another-project', null, 'catalog'],
] as const

function renderRefresh() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { readonly children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  renderHook(
    () => {
      useQueries({
        queries: MOUNTED_KEYS.map((queryKey) =>
          queryOptions({ queryKey, queryFn: () => manageProjectActions(queryKey) }),
        ),
      })
      useSessionHostRefresh({
        activeSessionId: ACTIVE,
        loadChatSessions: async () => {},
        loadSessionTrees: async () => {},
        updateSessionTitle: () => {},
        refreshCatalogSessions: async () => {},
        refreshSession: async () => {},
        refreshSessionTree: async () => {},
      })
    },
    { wrapper },
  )
  const receive = onSessionHostEvent.mock.calls.at(-1)?.[0]
  if (!receive) throw new Error('Host subscription missing')
  return receive
}

function readKinds() {
  return manageProjectActions.mock.calls.map(([key]) => `${String(key[1])}:${String(key.at(-1))}`)
}

/*
 * PR 391 review R2 P3-9: every Session state change invalidated every Project Actions query of
 * every project and scope, discovery included, so a busy Hive read more than the polls removed.
 */
describe('useSessionHostRefresh: Project Actions reads on Session changes', () => {
  beforeEach(() => {
    onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
    manageProjectActions.mockClear()
    useSessionStore.setState({
      sessions: [
        summary(ACTIVE, '/active-project'),
        ...WORKERS.map((worker) => summary(worker, '/hive-project')),
      ],
      archivedSessions: [],
      hiveSessions: [],
    })
  })

  it('reads nothing for Workers of another project', async () => {
    const receive = renderRefresh()
    await act(async () => {})
    manageProjectActions.mockClear()

    for (const worker of WORKERS) {
      await act(async () => {
        receive(stateChanged(worker))
      })
    }

    expect(readKinds()).toEqual([])
  })

  it("reads the changed Session's project again, without discovery", async () => {
    const receive = renderRefresh()
    await act(async () => {})
    manageProjectActions.mockClear()

    await act(async () => {
      receive(stateChanged(ACTIVE))
    })

    expect(readKinds().sort()).toEqual([
      '/active-project:catalog',
      '/active-project:runs',
      '/active-project:shortcut-presentation',
    ])
  })

  /*
   * Review V1 P3-5: a Session the window has not loaded (created in the same batch, or a Worker
   * beyond the loaded catalog page) has no known project, so narrowing by project read nothing and
   * its Project Action run never reached the open panel.
   */
  it("reads every project's queries, without discovery, for a Session the window has not loaded", async () => {
    const receive = renderRefresh()
    await act(async () => {})
    manageProjectActions.mockClear()

    await act(async () => {
      receive(stateChanged(SessionId('worker-beyond-the-loaded-page')))
    })

    expect(readKinds().sort()).toEqual([
      '/active-project:catalog',
      '/active-project:runs',
      '/active-project:shortcut-presentation',
      '/another-project:catalog',
    ])
  })

  it('finds a changed Hive Worker in the Hive list', async () => {
    useSessionStore.setState({
      sessions: [summary(ACTIVE, '/active-project')],
      hiveSessions: WORKERS.map((worker) => summary(worker, '/hive-project')),
    })
    const receive = renderRefresh()
    await act(async () => {})
    manageProjectActions.mockClear()

    await act(async () => {
      receive(stateChanged(WORKERS[0] ?? ACTIVE))
    })

    expect(readKinds()).toEqual([])
  })
})
