import type { AgentTransportEvent } from '@shared/types/stream'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { useAgentLoopEventStore } from '../../state/agent-loop-event-store'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import {
  DEFAULT_LAG_MS,
  type EndRunOptions,
  inAct,
  settle,
  type ViewOptions,
} from './transcript-order.harness-support'
import { createHostModel } from './transcript-order.host-model'
import { installHostReads, routeView } from './transcript-order.host-reads'
import {
  transcriptOrderApiMock as apiMock,
  transcriptOrderChatStoreMock as chatStoreMock,
  type RunCompletedPayload,
} from './transcript-order.ipc-mock'
import { createTranscriptKnowledge, missingMessages } from './transcript-order.knowledge'
import { MODEL, SESSION_ID } from './transcript-order.persisted'
import { createPromotions } from './transcript-order.promotions'
import { createRouteStore } from './transcript-order.route-store'
import { createRunKinds } from './transcript-order.run-kinds'
import { messageKey } from './transcript-order.violations'

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('./transcript-order.ipc-mock')).transcriptOrderApiMock,
}))
vi.mock('@/features/chat/state/chat-store', async () => ({
  useChatStore: (await import('./transcript-order.ipc-mock')).useTranscriptOrderChatStore,
}))

/*
 * The renderer side of the transcript-order harness: the real monitor and chat hook over a mocked
 * IPC bridge, driven by the Host model, with what disturbs a transcript injected.
 */

export async function loadTranscriptOrderHooks() {
  const { useAgentChat } = await import('../useAgentChat')
  const { useBackgroundRunMonitor } = await import('../useBackgroundRunMonitor')
  return { useAgentChat, useBackgroundRunMonitor }
}

type Hooks = Awaited<ReturnType<typeof loadTranscriptOrderHooks>>
export type TranscriptOrderHarness = ReturnType<typeof createTranscriptOrderHarness>

export function createTranscriptOrderHarness(hooks: Hooks, options: { lagMs?: number } = {}) {
  const lagMs = options.lagMs ?? DEFAULT_LAG_MS
  const route = createRouteStore()
  let dropping = false
  let missedSettlement = false
  let missedRunStart: string | null = null
  // The settlements on their way, oldest first: the bridge relays them in order.
  const pendingSettlements: Array<() => Promise<void>> = []
  const deliver = (event: AgentTransportEvent) => {
    // One clock: the renderer's runs `lagMs` behind the Host's, whether or not the event arrives.
    vi.setSystemTime(Math.max(Date.now(), event.timestamp + lagMs))
    if (dropping) return
    const tracked = useBackgroundRunStore.getState().renderSnapshotsBySessionId.has(SESSION_ID)
    for (const handler of [...apiMock.agentEventHandlers]) handler({ sessionId: SESSION_ID, event })
    knowledge.noteDelivered(event, tracked, viewSession())
  }
  const host = createHostModel(deliver)
  const reads = installHostReads(host, route)
  const knowledge = createTranscriptKnowledge(host)
  const promotions = createPromotions(host)
  vi.setSystemTime(host.now() + lagMs)
  const mountChat = () =>
    renderHook(() => {
      const state = useSyncExternalStore(route.subscribe, route.get)
      return hooks.useAgentChat(state.sessionId, state.detail, MODEL)
    })
  let chat = mountChat()
  let monitor: { readonly unmount: () => void } | null = null
  const notifySettled = (payload: Omit<RunCompletedPayload, 'sessionId'>) =>
    inAct(() => {
      // A Follow-up or a Run started before this settlement keeps the transcript live till it ends.
      if (!payload.continues && !host.activeRunId()) knowledge.noteSettled()
      for (const handler of [...apiMock.runCompletedHandlers]) {
        handler({ sessionId: SESSION_ID, ...payload })
      }
    })
  const startRun = (runId: string, prompt: string) =>
    act(() => {
      promotions.forgetUndelivered()
      host.startRun(runId)
      missedRunStart = dropping ? runId : null
      host.incorporateUser(prompt)
    })
  const viewSession = () => route.get().sessionId === SESSION_ID && route.get().detail !== null
  const quiet = () => viewSession() && !dropping && !reads.pending()
  const isLoading = () => chat.result.current.isLoading
  const refresh = async () => {
    if (route.get().sessionId !== SESSION_ID) return
    await inAct(() => route.set({ sessionId: SESSION_ID, detail: host.detail() }))
    await settle()
  }

  const harness = {
    shownKeys: () => chat.result.current.messages.flatMap((message) => messageKey(message) ?? []),
    truthKeys: () => host.truthKeys(),
    holdsHostReads: () => reads.pending(),
    hasLastDetail: () => route.lastDetail(SESSION_ID) !== null,
    stillRunning: () =>
      quiet() && pendingSettlements.length === 0 && !host.activeRunId() && isLoading(),
    idleWhileRunning: () => quiet() && host.activeRunId() !== null && !isLoading(),
    ...createRunKinds({ host, notifySettled, refreshDetail: (): Promise<void> => refresh() }),
    /** The messages the chat must show now, or none while events or Host reads are held back. */
    noteShown: () => knowledge.noteShown(chat.result.current.messages.map((message) => message.id)),
    missingKeys: () =>
      viewSession() && !reads.pending()
        ? missingMessages(harness.shownKeys(), knowledge.requiredKeys(route.get().detail, dropping))
        : [],
    pendingPreviewKeys: () => promotions.pendingKeys(),
    settle,
    async mount(view: 'session' | 'other' = 'session') {
      monitor = renderHook(() => hooks.useBackgroundRunMonitor())
      await settle()
      await harness.view(view)
    },
    async view(view: 'session' | 'other', viewOptions: ViewOptions = {}) {
      const loading = view === 'session' && viewOptions.cached === false
      const detail = viewOptions.stale ? route.lastDetail(SESSION_ID) : host.detail()
      await inAct(() => route.set(routeView(view, loading ? null : detail)))
      if (loading) await inAct(() => route.set({ sessionId: SESSION_ID, detail: host.detail() }))
      await settle()
    },
    /** The chat store refetches the shown Session; `touched` when the Session changed meanwhile. */
    async refreshDetail(options: { readonly touched?: boolean } = {}) {
      if (options.touched) host.touch()
      await refresh()
    },
    async send(text: string, runId: string) {
      apiMock.sendMessage.mockImplementationOnce(async () => {
        await Promise.resolve()
        host.rendererActedAt(Date.now())
        startRun(runId, text)
        return { outcome: 'delivered' as const, runId }
      })
      await inAct(() => {
        void chat.result.current.sendMessage({ text, attachments: [] }).catch(() => undefined)
      })
      await settle()
    },
    startRun,
    retry: () => act(() => host.retry()),
    steer: (text: string) => act(() => host.incorporateUser(text)),
    answer: (text: string, answer?: { readonly tools?: number; readonly open?: boolean }) =>
      act(() => host.answer(text, answer)),
    /** An answer whose middle text deltas are lost in a stall; the stream then resyncs. */
    async answerWithGap(text: string, answer: { readonly tools?: number } = {}) {
      act(() =>
        host.answer(text, {
          ...answer,
          beforeDelta: (index, count) => {
            dropping = index > 0 && index < count - 1
          },
        }),
      )
      dropping = false
      await harness.resume()
    },
    compact: () => act(() => host.compact()),
    dropRetainedUsers: () => host.dropRetainedUsers(),
    async compactManually() {
      let finish = () => {}
      act(() => {
        finish = host.compactManually()
      })
      await settle()
      act(() => finish())
      await notifySettled({})
      await harness.refreshDetail()
    },
    promote: (text: string) => promotions.promote(chat.result.current, text),
    answerPromotion: (text: string) => promotions.answer(text),
    /** The Run ends; `continues` names the queued Follow-up's Run the Host goes straight on to. */
    async endRun(end: EndRunOptions = {}) {
      let runId = ''
      act(() => {
        runId = host.finishRun(end.stop ? 'aborted' : 'stop', end.after, end.hostSettled)
      })
      const settlement = async () => {
        act(() => host.settleRun())
        // The Host puts a steer Pi never incorporated back in the queue as the Run settles.
        if (!end.continues && !host.activeRunId()) promotions.forgetUndelivered()
        const next = end.continues
        const terminalStatus = end.stop ? 'interrupted' : 'completed'
        if (dropping) missedSettlement = true
        else await notifySettled({ runId, terminalStatus, ...(next ? { continues: true } : {}) })
        if (next) startRun(next, end.followUp ?? `${next} prompt`)
        // The shell refetches the shown Session on its settlement event (`useSessionHostRefresh`).
        if (!dropping && !end.refetchLater) await harness.refreshDetail()
        await settle()
      }
      if (end.settleLater) pendingSettlements.push(settlement)
      else await settlement()
    },
    /** The oldest settlement on its way reaches the renderer. */
    settleRun: async () => pendingSettlements.shift()?.(),
    settlementPending: () => pendingSettlements.length > 0,
    stall() {
      dropping = true
    },
    /** A resync: the bridge settles or announces the Runs it missed; the store refetches. */
    async resume() {
      dropping = false
      const activeRunId = host.activeRunId()
      if (missedSettlement && !activeRunId) await notifySettled({})
      const buffer = host.buffer()
      if (missedRunStart !== null && missedRunStart === activeRunId && buffer) {
        const runId = `remote-snapshot:${SESSION_ID}`
        act(() =>
          deliver({ type: 'agent_start', runId, model: MODEL, timestamp: buffer.startedAt }),
        )
      }
      missedSettlement = false
      missedRunStart = null
      await inAct(() => {
        for (const handler of [...apiMock.resyncHandlers]) handler()
      })
      await harness.refreshDetail()
    },
    resync: () =>
      inAct(() => {
        for (const handler of [...apiMock.resyncHandlers]) handler()
      }),
    holdReconnects: (hold: { readonly onRelease?: boolean } = {}) =>
      reads.hold(hold.onRelease ?? false),
    serveHeldReads: () => reads.serve(),
    async releaseReconnects(release: { readonly newestFirst?: boolean } = {}) {
      const answers = reads.release(release.newestFirst ?? false)
      await inAct(() => {
        for (const answer of answers) answer()
      })
      await settle()
    },
    async reloadRenderer(view: 'session' | 'other' = 'session') {
      await harness.unmount()
      resetRendererState()
      knowledge.forget()
      knowledge.noteSettled()
      reads.reportActiveRun()
      await inAct(() => route.set(routeView(view, host.detail())))
      chat = mountChat()
      monitor = renderHook(() => hooks.useBackgroundRunMonitor())
      await settle()
    },
    async restartHost() {
      dropping = false
      missedSettlement = false
      host.restart()
      promotions.forgetUndelivered()
      await notifySettled({})
      await harness.refreshDetail()
    },
    async unmount() {
      await inAct(() => {
        chat.unmount()
        monitor?.unmount()
        monitor = null
      })
    },
  }

  return harness
}

function resetRendererState() {
  apiMock.agentEventHandlers.length = 0
  apiMock.runCompletedHandlers.length = 0
  apiMock.resyncHandlers.length = 0
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    runModelBySessionId: new Map(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
  useAgentLoopEventStore.setState({ sessionsById: new Map() })
  useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
  useOptimisticSteerStore.getState().clearSession(SESSION_ID)
  useRunFinishingStore.getState().clear(SESSION_ID)
}

export function resetTranscriptOrderState() {
  vi.useFakeTimers({ toFake: ['Date'] })
  resetRendererState()
  apiMock.listActiveRuns.mockReset().mockResolvedValue([])
  apiMock.sendMessage.mockReset().mockResolvedValue({ outcome: 'delivered' })
  chatStoreMock.refreshSession.mockReset().mockResolvedValue(undefined)
  chatStoreMock.upsertSession.mockReset()
}

export async function cleanupTranscriptOrder() {
  await act(async () => {
    cleanup()
    await Promise.resolve()
  })
  vi.useRealTimers()
}
