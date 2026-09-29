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
  clearSend: (send) =>
    set((state) => {
      const entry = [...state.bySession].find(([, pending]) => pending === send)
      if (!entry) return state
      const bySession = new Map(state.bySession)
      bySession.delete(entry[0])
      return { bySession }
    }),
}))

/** The pending send of the Session (or draft) on screen, or `null`. */
export function usePendingSendFor(sessionId: SessionId | null) {
  return usePendingSendStore((state) => state.bySession.get(scopeKey(sessionId)) ?? null)
}
