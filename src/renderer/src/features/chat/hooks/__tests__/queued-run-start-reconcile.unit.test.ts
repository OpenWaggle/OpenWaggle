import { SessionId } from '@shared/types/brand'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { querySessionControl } = vi.hoisted(() => ({ querySessionControl: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { querySessionControl } }))

const { reconcileQueuedRunStarts } = await import('../queued-run-start-reconcile')
const { sessionFollowUpQueueOptions } = await import('../useSessionFollowUpQueue')
const { useQueuedRunStartStore } = await import('../../state/queued-run-start-store')

const IDLE = SessionId('session-idle')
const BUSY = SessionId('session-busy')

function queueList(sessionId: string, activeRunId: string | null) {
  return {
    contractVersion: 2 as const,
    requestId: 'query-1',
    outcome: {
      operation: 'queue-list' as const,
      sessionId,
      queueState: 'running' as const,
      queueRevision: 1,
      activeRunId,
      items: [],
      omittedBodyCount: 0,
    },
  }
}

function hostReports(activeRunIds: ReadonlyMap<string, string | null>) {
  querySessionControl.mockImplementation(
    async (request: { readonly query: { readonly sessionId: string } }) =>
      queueList(request.query.sessionId, activeRunIds.get(request.query.sessionId) ?? null),
  )
}

function marked(sessionId: SessionId) {
  return useQueuedRunStartStore.getState().runIdBySessionId.get(sessionId)
}

describe('reconcileQueuedRunStarts after a Session Host resync', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    querySessionControl.mockReset()
    useQueuedRunStartStore.setState({ runIdBySessionId: new Map(), reportedRunIds: new Map() })
  })

  it("drops a mark whose Run's events were lost once the Host reports the Session idle", async () => {
    useQueuedRunStartStore.getState().mark(IDLE, 'run-lost')
    useQueuedRunStartStore.getState().mark(BUSY, 'run-going')
    // A stale cached read from before the Run started must not decide it: the resync invalidated it.
    queryClient.setQueryData(sessionFollowUpQueueOptions(IDLE).queryKey, {
      state: 'running',
      revision: 0,
      activeRunId: 'run-lost',
      items: [],
      waitingOnEdit: false,
    })
    await queryClient.invalidateQueries({ queryKey: ['session-control', 'queue'] })
    hostReports(new Map([[String(BUSY), 'run-going']]))

    await reconcileQueuedRunStarts(queryClient)

    expect(marked(IDLE)).toBeUndefined()
    expect(marked(BUSY)).toBe('run-going')
    // The settled Run is remembered, so a late answer for it cannot lock the pickers again.
    useQueuedRunStartStore.getState().mark(IDLE, 'run-lost')
    expect(marked(IDLE)).toBeUndefined()
  })

  it('keeps a newer mark set while the queue was being re-read', async () => {
    useQueuedRunStartStore.getState().mark(IDLE, 'run-old')
    querySessionControl.mockImplementation(async () => {
      useQueuedRunStartStore.getState().mark(IDLE, 'run-new')
      return queueList(String(IDLE), null)
    })

    await reconcileQueuedRunStarts(queryClient)

    expect(marked(IDLE)).toBe('run-new')
  })

  it('keeps the mark when the queue cannot be read', async () => {
    useQueuedRunStartStore.getState().mark(IDLE, 'run-1')
    querySessionControl.mockRejectedValue(new Error('Host unavailable'))

    await reconcileQueuedRunStarts(queryClient)

    expect(marked(IDLE)).toBe('run-1')
  })
})
