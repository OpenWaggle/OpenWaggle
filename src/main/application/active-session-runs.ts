import type { ActiveCompactionInfo } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import { ActiveRunManager } from './active-run-manager'
import {
  preAdmissionWaggleSessionIds,
  requestAllPreAdmissionWaggleInterruptions,
  requestPreAdmissionWaggleInterruptions,
} from './pre-admission-waggle-attempts'

import {
  type ActiveSessionRunReservation,
  activeSessionWriters,
  reserveSessionWriter,
} from './session-writer-reservations'

export {
  type ActiveSessionRunReservation,
  type ClaimedSessionWriterSuccessor,
  claimSessionWriterSuccessor,
  claimSessionWriterSuccessorAndWait,
  currentSessionWriterRunId,
  hasClaimedSessionWriterSuccessor,
  interruptSessionWriterAndWait,
  releaseClaimedSessionWriterSuccessor,
  type SessionWriterKind,
} from './session-writer-reservations'

interface AgentRunMetadata {
  readonly model?: SupportedModelId
  readonly runId: string
}

interface WaggleRunMetadata {
  readonly runId: string
}

interface CompactionMetadata {
  readonly model: SupportedModelId
  readonly reason: 'manual'
  readonly startedAt: number
}

const activeRuns = new ActiveRunManager<SessionId, AgentRunMetadata>()
const pendingClassicRuns = new ActiveRunManager<SessionId, AgentRunMetadata>()
const activeCompactions = new ActiveRunManager<SessionId, CompactionMetadata>()
const activeWaggleRuns = new ActiveRunManager<SessionId, WaggleRunMetadata>()
const pendingWaggleRuns = new ActiveRunManager<SessionId, WaggleRunMetadata>()
const ACTIVE_RUN_POLL_INTERVAL_MS = 50
const sessionRemovalFences = new Map<SessionId, symbol>()

export { activeCompactions, activeRuns, activeWaggleRuns, pendingWaggleRuns }

export function reserveActiveSessionRun(
  sessionId: SessionId,
  runId: string,
  successorToken?: symbol,
): ActiveSessionRunReservation {
  assertSessionRunStartAllowed(sessionId)
  const writer = reserveSessionWriter({
    sessionId,
    kind: 'classic',
    runId,
    ...(successorToken ? { successorToken } : {}),
  })
  const { controller } = writer
  activeRuns.register(sessionId, controller, { runId })
  return {
    controller,
    release: () => {
      activeRuns.deleteIfCurrent(sessionId, controller)
      writer.release()
    },
  }
}

export function reserveCompactionSessionWriter(
  sessionId: SessionId,
  controller: AbortController,
  model: SupportedModelId,
) {
  assertSessionRunStartAllowed(sessionId)
  const writer = reserveSessionWriter({ sessionId, kind: 'compaction', controller })
  activeCompactions.register(sessionId, controller, {
    model,
    reason: 'manual',
    startedAt: Date.now(),
  })
  return {
    controller,
    release: () => {
      activeCompactions.deleteIfCurrent(sessionId, controller)
      writer.release()
    },
  }
}

export function reserveWaggleSessionWriter(
  sessionId: SessionId,
  controller: AbortController,
  runId: string,
  successorToken?: symbol,
) {
  assertSessionRunStartAllowed(sessionId)
  const writer = reserveSessionWriter({
    sessionId,
    kind: 'waggle',
    controller,
    runId,
    ...(successorToken ? { successorToken } : {}),
  })
  if (!activeWaggleRuns.isCurrent(sessionId, controller)) {
    activeWaggleRuns.register(sessionId, controller, { runId })
  }
  pendingWaggleRuns.deleteIfCurrent(sessionId, controller)
  return {
    controller,
    release: () => {
      activeWaggleRuns.deleteIfCurrent(sessionId, controller)
      writer.release()
    },
  }
}

export function reservePendingWaggleSessionRun(
  sessionId: SessionId,
  controller: AbortController,
  runId: string,
) {
  assertSessionRunStartAllowed(sessionId)
  if (pendingWaggleRuns.has(sessionId)) {
    throw new Error(`Session ${sessionId} already has a pending Waggle run.`)
  }
  pendingWaggleRuns.register(sessionId, controller, { runId })
  return {
    release: () => pendingWaggleRuns.deleteIfCurrent(sessionId, controller),
  }
}

export function reservePendingClassicSessionRun(
  sessionId: SessionId,
  runId: string,
): ActiveSessionRunReservation {
  assertSessionRunStartAllowed(sessionId)
  if (pendingClassicRuns.has(sessionId)) {
    throw new Error(`Session ${sessionId} already has a pending classic run.`)
  }
  const controller = new AbortController()
  pendingClassicRuns.register(sessionId, controller, { runId })
  return {
    controller,
    release: () => {
      pendingClassicRuns.deleteIfCurrent(sessionId, controller)
    },
  }
}

export function reserveSessionTreeMutation(sessionId: SessionId) {
  assertSessionRunStartAllowed(sessionId)
  return reserveSessionWriter({ sessionId, kind: 'tree-mutation' })
}

export function acquireSessionRemovalFence(sessionId: SessionId) {
  return acquireSessionRemovalAdmission(sessionId).release
}

export function acquireSessionRemovalAdmission(sessionId: SessionId) {
  if (sessionRemovalFences.has(sessionId)) {
    throw new Error('Session deletion or archive is already in progress.')
  }
  const token = Symbol('session-removal')
  sessionRemovalFences.set(sessionId, token)
  let released = false
  return {
    reserveTreeMutation: () => {
      if (released || sessionRemovalFences.get(sessionId) !== token) {
        throw new Error('Session removal admission is no longer held.')
      }
      return reserveSessionWriter({ sessionId, kind: 'tree-mutation' })
    },
    release: () => {
      if (released) return
      released = true
      if (sessionRemovalFences.get(sessionId) === token) sessionRemovalFences.delete(sessionId)
    },
  }
}

export function isSessionRemovalFenced(sessionId: SessionId) {
  return sessionRemovalFences.has(sessionId)
}

function assertSessionRunStartAllowed(sessionId: SessionId) {
  if (sessionRemovalFences.has(sessionId)) {
    throw new Error('The Session is being archived or deleted; new work cannot start.')
  }
}

export function ensureSessionRunStartAllowed(sessionId: SessionId) {
  return Effect.try({
    try: () => assertSessionRunStartAllowed(sessionId),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export function hasAnyActiveRun(sessionId: SessionId): boolean {
  return hasAnyUnsettledRun(sessionId)
}

function hasAnyUnsettledRun(sessionId: SessionId) {
  return (
    activeSessionWriters.has(sessionId) ||
    pendingClassicRuns.hasUnsettled(sessionId) ||
    pendingWaggleRuns.hasUnsettled(sessionId) ||
    [...preAdmissionWaggleSessionIds()].includes(sessionId) ||
    activeRuns.hasUnsettled(sessionId) ||
    activeCompactions.hasUnsettled(sessionId) ||
    activeWaggleRuns.hasUnsettled(sessionId)
  )
}

export function cancelSessionRuns(sessionId: SessionId): boolean {
  const writer = activeSessionWriters.get(sessionId)
  writer?.controller.abort()
  const cancelledAgent = activeRuns.cancel(sessionId)
  const cancelledPendingClassic = pendingClassicRuns.requestInterrupt(sessionId, () => true)
  const cancelledCompaction = cancelCompactionSessionRun(sessionId)
  // Waggle ownership is also a teardown fence. Keep its registry entries until the owning
  // command has settled persistent state and completed attachment cleanup.
  const cancelledWaggle = activeWaggleRuns.requestInterrupt(sessionId, () => true)
  const cancelledPendingWaggle = pendingWaggleRuns.requestInterrupt(sessionId, () => true)
  const cancelledPreAdmissionWaggle = requestPreAdmissionWaggleInterruptions(sessionId)
  return (
    writer !== undefined ||
    cancelledAgent ||
    cancelledPendingClassic ||
    cancelledCompaction ||
    cancelledWaggle ||
    cancelledPendingWaggle ||
    cancelledPreAdmissionWaggle
  )
}

export function cancelCompactionSessionRun(sessionId: SessionId): boolean {
  return activeCompactions.requestInterrupt(sessionId, () => true)
}

export function interruptExactSessionRun(sessionId: SessionId, runId: string) {
  for (const registry of [pendingClassicRuns, activeRuns, activeWaggleRuns, pendingWaggleRuns]) {
    if (registry.get(sessionId)?.metadata.runId === runId) {
      return registry.interruptAndWait(sessionId, (metadata) => metadata.runId === runId)
    }
  }
  return Promise.resolve(false)
}

export function requestExactSessionRunInterruption(sessionId: SessionId, runId: string) {
  if (activeRuns.requestInterrupt(sessionId, (metadata) => metadata.runId === runId)) return true
  if (pendingClassicRuns.requestInterrupt(sessionId, (metadata) => metadata.runId === runId))
    return true
  if (activeWaggleRuns.requestInterrupt(sessionId, (metadata) => metadata.runId === runId))
    return true
  return pendingWaggleRuns.requestInterrupt(sessionId, (metadata) => metadata.runId === runId)
}

export function getAllActiveRunSessionIds(): SessionId[] {
  return [
    ...new Set([
      ...activeSessionWriters.keys(),
      ...activeRuns.unsettledKeys(),
      ...pendingClassicRuns.unsettledKeys(),
      ...activeCompactions.unsettledKeys(),
      ...activeWaggleRuns.unsettledKeys(),
      ...pendingWaggleRuns.unsettledKeys(),
      ...preAdmissionWaggleSessionIds(),
    ]),
  ]
}

export function listActiveCompactions(): ActiveCompactionInfo[] {
  const result: ActiveCompactionInfo[] = []
  for (const sessionId of activeCompactions.keys()) {
    const entry = activeCompactions.get(sessionId)
    if (!entry) continue
    result.push({
      activity: 'compaction',
      sessionId,
      model: entry.metadata.model,
      reason: entry.metadata.reason,
      startedAt: entry.metadata.startedAt,
    })
  }
  return result
}

export function cancelAllSessionRuns(): SessionId[] {
  const sessionIds = getAllActiveRunSessionIds()
  for (const writer of activeSessionWriters.values()) writer.controller.abort()
  activeRuns.cancelAll()
  for (const sessionId of pendingClassicRuns.keys()) {
    pendingClassicRuns.requestInterrupt(sessionId, () => true)
  }
  for (const sessionId of activeCompactions.keys()) cancelCompactionSessionRun(sessionId)
  for (const sessionId of activeWaggleRuns.keys()) {
    activeWaggleRuns.requestInterrupt(sessionId, () => true)
  }
  for (const sessionId of pendingWaggleRuns.keys()) {
    pendingWaggleRuns.requestInterrupt(sessionId, () => true)
  }
  requestAllPreAdmissionWaggleInterruptions()
  return sessionIds
}

export async function waitForSessionRuns(sessionId: SessionId, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (hasAnyUnsettledRun(sessionId) && Date.now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(ACTIVE_RUN_POLL_INTERVAL_MS, deadline - Date.now())),
    )
  }
  return !hasAnyUnsettledRun(sessionId)
}
