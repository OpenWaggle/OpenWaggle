import type { SessionDetail } from '@shared/types/session'
import type { HostModel } from './transcript-order.host-model'
import {
  transcriptOrderApiMock as apiMock,
  transcriptOrderChatStoreMock as chatStoreMock,
} from './transcript-order.ipc-mock'
import { SESSION_ID } from './transcript-order.persisted'
import {
  type createRouteStore,
  OTHER_DETAIL,
  OTHER_SESSION_ID,
} from './transcript-order.route-store'

/** What the route shows when the user opens `view`. */
export function routeView(view: 'session' | 'other', detail: SessionDetail | null) {
  return view === 'other'
    ? { sessionId: OTHER_SESSION_ID, detail: OTHER_DETAIL }
    : { sessionId: SESSION_ID, detail }
}

/**
 * The renderer's reads of the Host, answered from the Host model. A reconnect asks the Host for
 * the detail (slow when it is busy), then reads the Electron main replica of the stream buffer,
 * which answers at once with what it holds then. The chat store's refetch lands on the route.
 */
export function installHostReads(host: HostModel, route: ReturnType<typeof createRouteStore>) {
  let holding = false
  let answeredOnRelease = false
  const held: Array<{ readonly deliver: () => void; readonly serve: () => void }> = []
  apiMock.getSessionDetail.mockImplementation(async (sessionId: string) => {
    let answer = sessionId === SESSION_ID ? host.detail() : OTHER_DETAIL
    if (!holding) return answer
    let served = !answeredOnRelease
    return new Promise<SessionDetail>((resolve) =>
      held.push({
        deliver: () => resolve(sessionId === SESSION_ID && !served ? host.detail() : answer),
        serve: () => {
          if (served || sessionId !== SESSION_ID) return
          answer = host.detail()
          served = true
        },
      }),
    )
  })
  apiMock.getBackgroundRun.mockImplementation(async (sessionId: string) =>
    sessionId === SESSION_ID ? host.buffer() : null,
  )
  chatStoreMock.refreshSession.mockImplementation(async (sessionId: string) => {
    if (sessionId === SESSION_ID && route.get().sessionId === SESSION_ID) {
      route.set({ sessionId: SESSION_ID, detail: host.detail() })
    }
  })
  chatStoreMock.upsertSession.mockImplementation((detail: SessionDetail) => {
    if (route.get().sessionId === detail.id) route.set({ sessionId: detail.id, detail })
  })
  return {
    holding: () => holding,
    /** Whether a held read is in flight: what it answers has not reached the renderer yet. */
    pending: () => held.length > 0,
    /**
     * Detail reads are answered only on release: with what the Host held when asked (the answer
     * was slow to arrive), or with `onRelease`, what it holds then (the Host was slow to read).
     */
    hold(onRelease: boolean) {
      holding = true
      answeredOnRelease = onRelease
    },
    /** The Host reads the held detail requests now; their answers are still on their way. */
    serve() {
      for (const read of held) read.serve()
    },
    /** The held answers, in the order they are delivered. */
    release(newestFirst: boolean) {
      holding = false
      const answers = held.splice(0).map((read) => read.deliver)
      return newestFirst ? answers.reverse() : answers
    },
    /** The Host's active Run, as a reloaded renderer lists it. */
    reportActiveRun() {
      const buffer = host.buffer()
      apiMock.listActiveRuns.mockResolvedValue(
        buffer && host.activeRunId()
          ? [{ ...buffer, activity: 'agent-run', activityEvents: [] }]
          : [],
      )
    },
  }
}
