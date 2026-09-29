import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'
import type { PendingSend } from '../lib/optimistic-user-message'

const DRAFT_SCOPE = 'draft'

function scopeKey(sessionId: SessionId | null) {
  return sessionId === null ? DRAFT_SCOPE : String(sessionId)
}

/**
 * Composer sends the transcript is waiting to hold near the top, by Session (ADR 0036).
 *
 * Outside React state on purpose: a draft's first send creates its Session, and the chat panel
 * remounts for the Session route, which dropped panel state before the sent message ever mounted.
 * Keyed by Session, so a send left pending can never hold another Session's message.
 */
interface PendingSendState {
  readonly bySession: ReadonlyMap<string, PendingSend>
  readonly begin: (sessionId: SessionId | null, send: PendingSend) => void
  /** A draft's first send now belongs to the Session it created. */
  readonly adoptDraft: (sessionId: SessionId) => void
  /** Clears this exact send, wherever it moved; a newer send in its place is kept. */
  readonly clearSend: (send: PendingSend) => void
  /** Ends a Session's send; the chat store calls it when the reader leaves that Session. */
  readonly clearSession: (sessionId: SessionId) => void
}

export const usePendingSendStore = create<PendingSendState>((set) => ({
  bySession: new Map(),
  begin: (sessionId, send) =>
    set((state) => ({ bySession: new Map(state.bySession).set(scopeKey(sessionId), send) })),
  adoptDraft: (sessionId) =>
    set((state) => {
      const draft = state.bySession.get(DRAFT_SCOPE)
      if (!draft) return state
      const bySession = new Map(state.bySession)
      bySession.delete(DRAFT_SCOPE)
      bySession.set(scopeKey(sessionId), draft)
      return { bySession }
    }),
  clearSession: (sessionId) =>
    set((state) => {
      if (!state.bySession.has(scopeKey(sessionId))) return state
      const bySession = new Map(state.bySession)
      bySession.delete(scopeKey(sessionId))
      return { bySession }
    }),
  clearSend: (send) =>
    set((state) => {
      const entry = [...state.bySession].find(([, pending]) => pending === send)
      if (!entry) return state
      const bySession = new Map(state.bySession)
      bySession.delete(entry[0])
      return { bySession }
    }),
}))

/** The chat panel's pending-send wiring for the Session (or draft) on screen. */
export function usePendingSend(sessionId: SessionId | null) {
  const pendingSend = usePendingSendStore(
    (state) => state.bySession.get(scopeKey(sessionId)) ?? null,
  )
  const { begin, clearSend } = usePendingSendStore.getState()
  return {
    /** Handed to the send workflow, which begins a send and clears it when the send throws. */
    workflow: {
      beginPendingSend: (send: PendingSend) => begin(sessionId, send),
      clearPendingSend: clearSend,
    },
    /** Handed to the transcript section, which holds the sent row and then consumes the send. */
    transcript: {
      pendingSend,
      onPendingSendConsumed: () => {
        if (pendingSend) clearSend(pendingSend)
      },
    },
  }
}
