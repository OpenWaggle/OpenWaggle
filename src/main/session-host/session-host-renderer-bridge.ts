import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId } from '@shared/types/brand'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
  replaceStreamBufferSnapshots,
  startStreamBufferFromAgentStart,
} from '../utils/stream-bridge'
import { watchLocalSessionEvents } from './local-session-client'
import { ensureLocalSessionHost } from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import type { LocalSessionHostPaths } from './local-session-paths'

const REMOTE_RECONNECT_DELAY_MS = 250

export interface RemoteSessionHostRendererBridgeDependencies {
  readonly watch: typeof watchLocalSessionEvents
  readonly ensure: () => Promise<unknown>
  readonly wait: (milliseconds: number) => Promise<void>
}

export function reconcileRemoteRunSnapshots(snapshots: readonly BackgroundRunSnapshot[]) {
  const previous = replaceStreamBufferSnapshots(snapshots)
  const next = new Set(snapshots.map((snapshot) => snapshot.sessionId))
  for (const sessionId of previous) {
    if (!next.has(sessionId)) {
      clearAgentPhase(sessionId)
      emitRunCompleted(sessionId)
    }
  }
  const previousSet = new Set(previous)
  for (const snapshot of snapshots) {
    if (previousSet.has(snapshot.sessionId)) continue
    emitTransportEvent(snapshot.sessionId, {
      type: 'agent_start',
      runId: `remote-snapshot:${snapshot.sessionId}`,
      model: snapshot.model,
      timestamp: snapshot.startedAt,
    })
  }
}

export function relaySessionHostEvent(
  delivery: SessionHostEventEnvelope,
  options: { readonly streamBufferAlreadyProjected?: boolean } = {},
) {
  if (delivery.payload.kind === 'session-transport') {
    const sessionId = SessionId(delivery.payload.sessionId)
    if (!options.streamBufferAlreadyProjected && delivery.payload.event.type === 'agent_start') {
      startStreamBufferFromAgentStart(sessionId, delivery.payload.event)
    }
    emitTransportEvent(sessionId, delivery.payload.event, {
      projectStreamBuffer: !options.streamBufferAlreadyProjected,
    })
    return
  }
  if (delivery.payload.kind === 'session-waggle-transport') {
    emitWaggleTransportEvent(
      SessionId(delivery.payload.sessionId),
      delivery.payload.event,
      delivery.payload.meta,
    )
    return
  }
  if (delivery.payload.kind === 'session-waggle-turn') {
    emitWaggleTurnEvent(SessionId(delivery.payload.sessionId), delivery.payload.event)
    return
  }
  if (
    delivery.payload.kind === 'session-state-changed' &&
    delivery.payload.operation === 'run-settled'
  ) {
    const sessionId = SessionId(delivery.payload.sessionId)
    clearAgentPhase(sessionId)
    if (!options.streamBufferAlreadyProjected) clearStreamBuffer(sessionId)
    emitRunCompleted(sessionId)
  }
  broadcastToWindows('session-host:event', delivery)
}

export function startSessionHostRendererBridge(runtime: LocalSessionHostRuntime) {
  const initial = runtime.eventHub.subscribeAfter()
  if (initial.status !== 'ready') throw new Error('Could not subscribe the renderer Host bridge.')
  const releaseLiveness = runtime.liveness.acquire('subscription')
  let subscription = initial.subscription
  let stopped = false
  const pump = async () => {
    try {
      while (!stopped) {
        const delivery = await subscription.next()
        if (delivery.status === 'event') {
          relaySessionHostEvent(delivery.event, { streamBufferAlreadyProjected: true })
          continue
        }
        if (delivery.status !== 'resync-required') break
        broadcastToWindows('session-host:resync-required', { reason: delivery.reason })
        const replacement = runtime.eventHub.subscribeAfter()
        if (replacement.status !== 'ready') {
          broadcastToWindows('session-host:resync-required', { reason: replacement.reason })
          continue
        }
        subscription = replacement.subscription
      }
    } finally {
      releaseLiveness()
    }
  }
  void pump()
  return () => {
    if (stopped) return
    stopped = true
    subscription.close()
  }
}

export function startRemoteSessionHostRendererBridge(
  input: {
    readonly paths: LocalSessionHostPaths
    readonly clientVersion: string
  },
  dependencyOverrides: Partial<RemoteSessionHostRendererBridgeDependencies> = {},
) {
  const dependencies: RemoteSessionHostRendererBridgeDependencies = {
    watch: watchLocalSessionEvents,
    ensure: () =>
      ensureLocalSessionHost({
        paths: input.paths,
        clientKind: 'gui',
        clientVersion: input.clientVersion,
      }),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...dependencyOverrides,
  }
  const abortController = new AbortController()
  let after: SessionHostEventEnvelope['cursor'] | undefined
  let pendingResyncReason: string | undefined
  const pump = async () => {
    while (!abortController.signal.aborted) {
      try {
        const result = await dependencies.watch({
          paths: input.paths,
          clientKind: 'gui',
          clientVersion: input.clientVersion,
          workingDirectory: process.cwd(),
          ...(after ? { after } : {}),
          signal: abortController.signal,
          onSnapshot: (snapshots) => {
            reconcileRemoteRunSnapshots(snapshots)
            if (!pendingResyncReason) return
            const reason = pendingResyncReason
            pendingResyncReason = undefined
            broadcastToWindows('session-host:resync-required', { reason })
          },
          onCursor: (cursor) => {
            after = cursor
          },
          onEvent: (event) => {
            after = event.cursor
            relaySessionHostEvent(event)
          },
        })
        if (result.status === 'resync-required') {
          after = undefined
          pendingResyncReason = result.reason
        }
      } catch {
        // The last cursor is retained so a same-host reconnect replays the missed window.
        if (!abortController.signal.aborted) {
          await dependencies.ensure().catch(() => undefined)
        }
      }
      if (!abortController.signal.aborted) {
        await dependencies.wait(REMOTE_RECONNECT_DELAY_MS)
      }
    }
  }
  void pump()
  return () => abortController.abort()
}
