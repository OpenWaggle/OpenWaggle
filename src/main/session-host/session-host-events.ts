import { SessionId } from '@shared/types/brand'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import type { SessionHostEventHub } from '../application/session-host-event-hub'
import type { SessionHostLiveness } from '../application/session-host-liveness'
import { createLogger } from '../logger'
import {
  keepSessionScratchDirectory,
  removeSessionScratchDirectory,
} from '../utils/session-scratch-directory'
import {
  projectWorktreeLaunchFailure,
  projectWorktreeLaunchProgress,
  upsertStreamBufferRunIdentity,
} from '../utils/stream-bridge'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  startStreamBufferFromAgentStart,
} from '../utils/stream-buffer'

const logger = createLogger('session-host-events')

let publishEvent: ((payload: SessionHostEventPayload) => void) | null = null
let eventRuntime: {
  readonly eventHub: SessionHostEventHub
  readonly liveness: SessionHostLiveness
} | null = null
let semanticDiscoverySourceRevision = 0
const semanticDiscoverySourceObservers = new Set<{
  readonly afterRevision: number
  readonly wake: () => void
}>()

function changesSemanticDiscoverySource(payload: SessionHostEventPayload) {
  if (payload.kind === 'session-list-changed' || payload.kind === 'session-state-changed')
    return true
  return payload.kind === 'session-transport' && payload.event.type === 'message_end'
}

function notifySemanticDiscoverySourceObservers() {
  for (const observer of [...semanticDiscoverySourceObservers]) {
    if (semanticDiscoverySourceRevision <= observer.afterRevision) continue
    semanticDiscoverySourceObservers.delete(observer)
    observer.wake()
  }
}

/** Scratch files are disposable, so an archived or deleted Session gives its directory up. */
function releaseSessionScratchDirectory(payload: SessionHostEventPayload) {
  if (payload.kind !== 'session-list-changed') return
  if (payload.change === 'unarchived') {
    keepSessionScratchDirectory(payload.sessionId)
    return
  }
  if (payload.change !== 'archived' && payload.change !== 'deleted') return
  void removeSessionScratchDirectory(payload.sessionId).catch((error: unknown) => {
    logger.warn('Could not remove the session scratch directory', {
      sessionId: payload.sessionId,
      error: String(error),
    })
  })
}

function projectHostOwnedRunState(payload: SessionHostEventPayload) {
  releaseSessionScratchDirectory(payload)
  if (payload.kind === 'session-transport') {
    const sessionId = SessionId(payload.sessionId)
    if (payload.event.type === 'agent_start') {
      startStreamBufferFromAgentStart(sessionId, payload.event)
    }
    applyEventToStreamBuffer(sessionId, payload.event)
    return
  }
  if (payload.kind === 'session-worktree-launch') {
    const sessionId = SessionId(payload.sessionId)
    upsertStreamBufferRunIdentity(sessionId, payload.model, payload.mode)
    if (payload.event.type === 'progress') {
      projectWorktreeLaunchProgress(sessionId, payload.event.progress)
    } else {
      projectWorktreeLaunchFailure(sessionId, payload.event.errorMessage)
    }
    return
  }
  if (payload.kind === 'session-state-changed' && payload.operation === 'run-settled') {
    clearStreamBuffer(SessionId(payload.sessionId))
  }
}

export function currentSemanticDiscoverySourceRevision() {
  return semanticDiscoverySourceRevision
}

export function subscribeSemanticDiscoverySourceChangesAfter(
  afterRevision: number,
  wake: () => void,
) {
  const observer = { afterRevision, wake }
  semanticDiscoverySourceObservers.add(observer)
  notifySemanticDiscoverySourceObservers()
  return () => semanticDiscoverySourceObservers.delete(observer)
}

export function installSessionHostEventPublisher(
  publisher: (payload: SessionHostEventPayload) => void,
) {
  if (publishEvent) throw new Error('A Session Host event publisher is already installed.')
  publishEvent = publisher
  return () => {
    if (publishEvent === publisher) publishEvent = null
  }
}

export function publishSessionHostEvent(payload: SessionHostEventPayload): void {
  publishEvent?.(payload)
  if (changesSemanticDiscoverySource(payload)) {
    semanticDiscoverySourceRevision += 1
    notifySemanticDiscoverySourceObservers()
  }
}

export function installSessionHostEventRuntime(input: {
  readonly eventHub: SessionHostEventHub
  readonly liveness: SessionHostLiveness
}) {
  if (eventRuntime) throw new Error('A Session Host event runtime is already installed.')
  eventRuntime = input
  const releasePublisher = installSessionHostEventPublisher((payload) => {
    projectHostOwnedRunState(payload)
    input.eventHub.publish(payload)
  })
  return () => {
    releasePublisher()
    if (eventRuntime === input) eventRuntime = null
  }
}

export function getSessionHostEventRuntime() {
  if (!eventRuntime) throw new Error('The Session Host event runtime is not available.')
  return eventRuntime
}

export function tryGetSessionHostEventRuntime() {
  return eventRuntime
}
