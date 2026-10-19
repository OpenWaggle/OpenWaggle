import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { create } from 'zustand'

/** One extension status line (`ctx.ui.setStatus(key, text)`), in the order its key was first set. */
export interface ExtensionStatusLine {
  readonly key: string
  readonly text: string
}

/** What the Run's Pi extensions say they are doing, as Pi's TUI footer would show it. */
export interface RunExtensionStatus {
  readonly runId: string
  readonly statuses: readonly ExtensionStatusLine[]
  /** `ctx.ui.setWorkingMessage(text)`: replaces the generic working label while it is set. */
  readonly workingMessage?: string
}

/**
 * Pi extension status text per Session, for the Run that set it.
 *
 * Pi runs a fresh session per Run, so a status belongs to its Run: it goes when the Run settles, or
 * when another Run starts in the Session. A status an extension never clears does not outlive it.
 */
interface ExtensionStatusState {
  readonly bySessionId: ReadonlyMap<SessionId, RunExtensionStatus>
  readonly apply: (sessionId: SessionId, event: AgentTransportEvent) => void
  /** The Run settled: its statuses go. Another Run's stay, unless the settled Run is unknown. */
  readonly clearRun: (sessionId: SessionId, runId: string | undefined) => void
}

type ExtensionStatusEvent = Extract<AgentTransportEvent, { readonly type: 'extension_status' }>

function withStatusLine(
  statuses: readonly ExtensionStatusLine[],
  key: string,
  text: string | undefined,
): readonly ExtensionStatusLine[] {
  if (text === undefined) return statuses.filter((line) => line.key !== key)
  if (!statuses.some((line) => line.key === key)) return [...statuses, { key, text }]
  return statuses.map((line) => (line.key === key ? { key, text } : line))
}

function appliedStatus(current: RunExtensionStatus | undefined, event: ExtensionStatusEvent) {
  const base: RunExtensionStatus =
    current?.runId === event.runId ? current : { runId: event.runId, statuses: [] }
  if (event.slot.kind === 'status') {
    return { ...base, statuses: withStatusLine(base.statuses, event.slot.key, event.text) }
  }
  return event.text === undefined
    ? { runId: base.runId, statuses: base.statuses }
    : { ...base, workingMessage: event.text }
}

function isEmpty(status: RunExtensionStatus) {
  return status.statuses.length === 0 && status.workingMessage === undefined
}

function withoutSession(bySessionId: ReadonlyMap<SessionId, RunExtensionStatus>, id: SessionId) {
  const next = new Map(bySessionId)
  next.delete(id)
  return next
}

export const useExtensionStatusStore = create<ExtensionStatusState>((set) => ({
  bySessionId: new Map(),
  apply: (sessionId, event) =>
    set((state) => {
      const current = state.bySessionId.get(sessionId)
      if (event.type === 'agent_start') {
        // Another Run started: the statuses of the one before it are stale.
        if (!current || current.runId === event.runId) return state
        return { bySessionId: withoutSession(state.bySessionId, sessionId) }
      }
      if (event.type !== 'extension_status') return state
      const next = appliedStatus(current, event)
      if (isEmpty(next)) {
        return current ? { bySessionId: withoutSession(state.bySessionId, sessionId) } : state
      }
      return { bySessionId: new Map(state.bySessionId).set(sessionId, next) }
    }),
  clearRun: (sessionId, runId) =>
    set((state) => {
      const current = state.bySessionId.get(sessionId)
      if (!current || (runId !== undefined && current.runId !== runId)) return state
      return { bySessionId: withoutSession(state.bySessionId, sessionId) }
    }),
}))

export function trackExtensionStatus(sessionId: SessionId, event: AgentTransportEvent) {
  if (event.type !== 'agent_start' && event.type !== 'extension_status') return
  useExtensionStatusStore.getState().apply(sessionId, event)
}

/** The Session's current Pi extension status, or undefined when no extension says anything. */
export function useRunExtensionStatus(sessionId: SessionId | null) {
  return useExtensionStatusStore((state) =>
    sessionId ? state.bySessionId.get(sessionId) : undefined,
  )
}
