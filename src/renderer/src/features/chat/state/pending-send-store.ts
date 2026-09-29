import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'
import type { PendingSend } from '../lib/optimistic-user-message'
import { useChatStore } from './chat-store'

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
  readonly clearSession: (sessionId: SessionId) => void
}

export const usePendingSendStore = create<PendingSendState>((set) => ({
  bySession: new Map(),
  begin: (sessionId, send) => {
    watchSessionLeave()
    set((state) => ({ bySession: new Map(state.bySession).set(scopeKey(sessionId), send) }))
  },
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

/*
 * Leaving a Session ends its pending send. One its transcript never held (the reader left before
 * the workspace loaded) would otherwise hold a long-finished message on the next visit and discard
 * the saved reading position. A draft's send is not left: it moves to the Session it creates.
 * Subscribed on the first send rather than at import, which a circular import would see too early.
 */
let watchingSessionLeave = false
function watchSessionLeave() {
  if (watchingSessionLeave) return
  watchingSessionLeave = true
  useChatStore.subscribe((state, previous) => {
    const left = previous.activeSessionId
    if (left !== null && state.activeSessionId !== left) {
      usePendingSendStore.getState().clearSession(left)
    }
  })
}

/** The pending send of the Session (or draft) on screen, with the actions that begin and end it. */
export function usePendingSend(sessionId: SessionId | null) {
  const pendingSend = usePendingSendStore(
    (state) => state.bySession.get(scopeKey(sessionId)) ?? null,
  )
  const { begin, clearSend } = usePendingSendStore.getState()
  return {
    pendingSend,
    begin: (send: PendingSend) => begin(sessionId, send),
    clearSend,
    consume: () => {
      if (pendingSend) clearSend(pendingSend)
    },
  }
}
