import type { SessionId } from '@shared/types/brand'

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

export interface ClaimedSessionWriterSuccessor {
  readonly token: symbol
  readonly settled: Promise<void>
}

export const activeSessionWriters = new Map<SessionId, SessionWriterEntry>()

export interface ActiveSessionRunReservation {
  readonly controller: AbortController
  readonly release: () => void
}

export function reserveSessionWriter(input: {
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
  const claimed = claimSessionWriterSuccessor(sessionId, kind)
  if (!writer || !claimed) return null
  const { token } = claimed
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

export function claimSessionWriterSuccessor(
  sessionId: SessionId,
  kind: SessionWriterKind,
): ClaimedSessionWriterSuccessor | null {
  const writer = activeSessionWriters.get(sessionId)
  if (!writer) return null
  if (writer.successor) throw new Error(`Session ${sessionId} already has a claimed successor.`)
  const token = Symbol(`${kind}:${sessionId}`)
  writer.successor = { kind, token }
  return { token, settled: writer.settled }
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
