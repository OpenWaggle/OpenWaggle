import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId } from '@shared/types/brand'
import type {
  SessionHostEventEnvelope,
  SessionHostEventPayload,
} from '@shared/types/session-host-event'
import { createLogger } from '../logger'
import { broadcastToWindows } from '../utils/broadcast'
import { startEventLoopStallMonitor } from '../utils/event-loop-stall-monitor'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
  emitWorktreeLaunchFailure,
  emitWorktreeLaunchProgress,
  replaceStreamBufferSnapshots,
  startStreamBufferFromAgentStart,
  upsertStreamBufferRunIdentity,
} from '../utils/stream-bridge'
import { watchLocalSessionEvents } from './local-session-client'
import { ensureLocalSessionHost } from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import { type LocalSessionHostPaths, refreshLocalSessionHostEndpoint } from './local-session-paths'
import {
  type RemoteSessionHostRendererBridgeDependencies,
  runRemoteSessionHostRendererPump,
} from './session-host-renderer-recovery'

const logger = createLogger('session-host/renderer-bridge')

export type { RemoteSessionHostRendererBridgeDependencies }

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
    broadcastToWindows('agent:worktree-launch', {
      sessionId: snapshot.sessionId,
      launch: snapshot.worktreeLaunch ?? null,
    })
    if (previousSet.has(snapshot.sessionId)) continue
    emitTransportEvent(snapshot.sessionId, {
      type: 'agent_start',
      runId: `remote-snapshot:${snapshot.sessionId}`,
      model: snapshot.model,
      timestamp: snapshot.startedAt,
    })
  }
}

function settledRunDetails(
  payload: Extract<SessionHostEventPayload, { kind: 'session-state-changed' }>,
) {
  return {
    ...(payload.runId ? { runId: payload.runId } : {}),
    ...(payload.terminalStatus ? { terminalStatus: payload.terminalStatus } : {}),
    ...(payload.failureCode ? { failureCode: payload.failureCode } : {}),
  }
}

/**
 * A Run settling ends the Session's activity, unless the Host went straight on to a queued
 * Follow-up. That Run's send is still told it completed (`continues`), so it is not left waiting for
 * the whole chain, while the Session keeps its streaming state for the next Run.
 */
function relaySettlement(
  payload: Extract<SessionHostEventPayload, { kind: 'session-state-changed' }>,
  options: { readonly streamBufferAlreadyProjected?: boolean },
) {
  const sessionId = SessionId(payload.sessionId)
  if (payload.operation === 'run-settled') {
    clearAgentPhase(sessionId)
    if (!options.streamBufferAlreadyProjected) clearStreamBuffer(sessionId)
    emitRunCompleted(sessionId, settledRunDetails(payload))
    return
  }
  if (payload.operation === 'follow-up-started' && payload.runId) {
    emitRunCompleted(sessionId, { ...settledRunDetails(payload), continues: true })
  }
}

export function relaySessionHostEvent(
  delivery: SessionHostEventEnvelope,
  options: { readonly streamBufferAlreadyProjected?: boolean } = {},
) {
  if (delivery.payload.kind === 'session-worktree-launch') {
    const sessionId = SessionId(delivery.payload.sessionId)
    upsertStreamBufferRunIdentity(sessionId, delivery.payload.model, delivery.payload.mode)
    const event = delivery.payload.event
    if (event.type === 'progress') {
      emitWorktreeLaunchProgress(sessionId, event.progress, {
        projectStreamBuffer: !options.streamBufferAlreadyProjected,
      })
    } else {
      emitWorktreeLaunchFailure(sessionId, event.errorMessage, {
        projectStreamBuffer: !options.streamBufferAlreadyProjected,
      })
    }
    return
  }
  if (delivery.payload.kind === 'session-transport') {
    const sessionId = SessionId(delivery.payload.sessionId)
    if (!options.streamBufferAlreadyProjected && delivery.payload.event.type === 'agent_start') {
      startStreamBufferFromAgentStart(sessionId, delivery.payload.event)
    }
    emitTransportEvent(sessionId, delivery.payload.event, {
      projectStreamBuffer: !options.streamBufferAlreadyProjected,
    })
    // Manual compaction is standalone activity, including after a GUI reconnect
    // that missed its start event. The owner publishes its end after releasing
    // the writer, before a queued successor can start.
    if (
      delivery.payload.event.type === 'compaction_end' &&
      delivery.payload.event.reason === 'manual'
    ) {
      emitRunCompleted(sessionId)
    }
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
  if (delivery.payload.kind === 'session-state-changed') {
    relaySettlement(delivery.payload, options)
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
    ensure: ensureLocalSessionHost,
    refreshPaths: refreshLocalSessionHostEndpoint,
    wait: (milliseconds, signal) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted()
        const abort = () => {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }, milliseconds)
        signal?.addEventListener('abort', abort, { once: true })
      }),
    logger,
    ...dependencyOverrides,
  }
  const abortController = new AbortController()
  // The same timeouts follow a stall in this process as in the Host; this tells them apart.
  const stopStallMonitor = startEventLoopStallMonitor({
    logger,
    message: 'Desktop main process event loop stalled; Session Host requests may have timed out.',
  })
  const pumpPromise = runRemoteSessionHostRendererPump({
    paths: input.paths,
    clientVersion: input.clientVersion,
    dependencies,
    signal: abortController.signal,
    handlers: {
      onSnapshot: reconcileRemoteRunSnapshots,
      onResyncRequired: (reason) => broadcastToWindows('session-host:resync-required', { reason }),
      onEvent: relaySessionHostEvent,
    },
  })
  return async () => {
    stopStallMonitor()
    abortController.abort()
    await pumpPromise
  }
}
