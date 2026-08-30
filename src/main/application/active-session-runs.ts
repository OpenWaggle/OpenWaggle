import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { ActiveRunManager } from './active-run-manager'

interface AgentRunMetadata {
  readonly model?: SupportedModelId
  readonly runId: string
}

interface WaggleRunMetadata {
  readonly runId: string
}

interface CompactionMetadata {
  readonly model: SupportedModelId
}

export type SessionWriterKind = 'classic' | 'waggle' | 'compaction' | 'tree-mutation'

interface SessionWriterEntry {
  readonly controller: AbortController
  readonly kind: SessionWriterKind
  readonly runId?: string
  readonly settled: Promise<void>
  readonly settle: () => void
  released: boolean
  successor?: { readonly kind: SessionWriterKind; readonly token: symbol }
}

const activeRuns = new ActiveRunManager<SessionId, AgentRunMetadata>()
const activeCompactions = new ActiveRunManager<SessionId, CompactionMetadata>()
const activeWaggleRuns = new ActiveRunManager<SessionId, WaggleRunMetadata>()
const pendingWaggleRuns = new ActiveRunManager<SessionId, WaggleRunMetadata>()
const activeSessionWriters = new Map<SessionId, SessionWriterEntry>()
const ACTIVE_RUN_POLL_INTERVAL_MS = 50

export { activeCompactions, activeRuns, activeWaggleRuns, pendingWaggleRuns }

export interface ActiveSessionRunReservation {
  readonly controller: AbortController
  readonly release: () => void
}

function reserveSessionWriter(input: {
  readonly sessionId: SessionId
  readonly kind: SessionWriterKind
  readonly controller?: AbortController
  readonly runId?: string
  readonly successorToken?: symbol
}): ActiveSessionRunReservation {
  const existing = activeSessionWriters.get(input.sessionId)
  const claimedSuccessor =
    existing?.released === true && existing.successor?.token === input.successorToken
  if (existing && !claimedSuccessor) {
    throw new Error(`Session ${input.sessionId} already has an active ${existing.kind} Pi writer.`)
  }
  const controller = input.controller ?? new AbortController()
  let settle: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const entry: SessionWriterEntry = {
    controller,
    kind: input.kind,
    ...(input.runId ? { runId: input.runId } : {}),
    settled,
    settle,
    released: false,
  }
  activeSessionWriters.set(input.sessionId, entry)
  let released = false
  return {
    controller,
    release: () => {
      if (released) return
      released = true
      entry.released = true
      if (activeSessionWriters.get(input.sessionId) === entry && !entry.successor) {
        activeSessionWriters.delete(input.sessionId)
      }
      entry.settle()
    },
  }
}

export function reserveActiveSessionRun(
  sessionId: SessionId,
  runId: string,
  successorToken?: symbol,
): ActiveSessionRunReservation {
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
  const writer = reserveSessionWriter({ sessionId, kind: 'compaction', controller })
  activeCompactions.register(sessionId, controller, { model })
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
  if (pendingWaggleRuns.has(sessionId)) {
    throw new Error(`Session ${sessionId} already has a pending Waggle run.`)
  }
  pendingWaggleRuns.register(sessionId, controller, { runId })
  return {
    release: () => pendingWaggleRuns.deleteIfCurrent(sessionId, controller),
  }
}

export function reserveSessionTreeMutation(sessionId: SessionId) {
  return reserveSessionWriter({ sessionId, kind: 'tree-mutation' })
}

export async function interruptSessionWriterAndWait(sessionId: SessionId) {
  const writer = activeSessionWriters.get(sessionId)
  if (!writer) return false
  writer.controller.abort()
  await writer.settled
  return true
}

export async function claimSessionWriterSuccessorAndWait(
  sessionId: SessionId,
  kind: SessionWriterKind,
  signal?: AbortSignal,
): Promise<symbol | null> {
  const writer = activeSessionWriters.get(sessionId)
  if (!writer) return null
  if (writer.successor) throw new Error(`Session ${sessionId} already has a claimed successor.`)
  const token = Symbol(`${kind}:${sessionId}`)
  writer.successor = { kind, token }
  writer.controller.abort()
  let rejectAbort: (error: Error) => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort(new Error(`Pending ${kind} Session writer was cancelled.`))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) onAbort()
    await Promise.race([writer.settled, aborted])
    if (signal?.aborted) throw new Error(`Pending ${kind} Session writer was cancelled.`)
  } catch (error) {
    releaseClaimedSessionWriterSuccessor(sessionId, token)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  return token
}

export function releaseClaimedSessionWriterSuccessor(sessionId: SessionId, token: symbol) {
  const writer = activeSessionWriters.get(sessionId)
  if (writer?.successor?.token !== token) return false
  delete writer.successor
  if (writer.released) activeSessionWriters.delete(sessionId)
  return true
}

export function hasClaimedSessionWriterSuccessor(sessionId: SessionId, runId: string) {
  const writer = activeSessionWriters.get(sessionId)
  return writer?.runId === runId && writer.successor !== undefined
}

export function currentSessionWriterRunId(sessionId: SessionId) {
  return activeSessionWriters.get(sessionId)?.runId
}

export function hasAnyActiveRun(sessionId: SessionId): boolean {
  return activeSessionWriters.has(sessionId)
}

export function cancelSessionRuns(sessionId: SessionId): boolean {
  const writer = activeSessionWriters.get(sessionId)
  writer?.controller.abort()
  const cancelledAgent = activeRuns.cancel(sessionId)
  const cancelledCompaction = activeCompactions.cancel(sessionId)
  const cancelledWaggle = activeWaggleRuns.cancel(sessionId)
  const cancelledPendingWaggle = pendingWaggleRuns.cancel(sessionId)
  return (
    writer !== undefined ||
    cancelledAgent ||
    cancelledCompaction ||
    cancelledWaggle ||
    cancelledPendingWaggle
  )
}

export async function interruptExactSessionRun(sessionId: SessionId, runId: string) {
  const interruptedAgent = await activeRuns.interruptAndWait(
    sessionId,
    (metadata) => metadata.runId === runId,
  )
  if (interruptedAgent) return true
  const interruptedWaggle = await activeWaggleRuns.interruptAndWait(
    sessionId,
    (metadata) => metadata.runId === runId,
  )
  if (interruptedWaggle) return true
  return pendingWaggleRuns.interruptAndWait(sessionId, (metadata) => metadata.runId === runId)
}

export function getAllActiveRunSessionIds(): SessionId[] {
  return [
    ...new Set([
      ...activeSessionWriters.keys(),
      ...activeRuns.keys(),
      ...activeCompactions.keys(),
      ...activeWaggleRuns.keys(),
      ...pendingWaggleRuns.keys(),
    ]),
  ]
}

export function cancelAllSessionRuns(): SessionId[] {
  const sessionIds = getAllActiveRunSessionIds()
  for (const writer of activeSessionWriters.values()) writer.controller.abort()
  activeRuns.cancelAll()
  activeCompactions.cancelAll()
  activeWaggleRuns.cancelAll()
  pendingWaggleRuns.cancelAll()
  return sessionIds
}

export async function waitForSessionRuns(sessionId: SessionId, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (hasAnyActiveRun(sessionId) && Date.now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(ACTIVE_RUN_POLL_INTERVAL_MS, deadline - Date.now())),
    )
  }
  return !hasAnyActiveRun(sessionId)
}
