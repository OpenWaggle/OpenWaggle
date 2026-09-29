import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { create } from 'zustand'
import { createChatActions } from './chat-store-actions'
import type { ChatState } from './chat-store-types'
import { usePendingSendStore } from './pending-send-store'

export type { DraftSessionState } from './chat-store-types'

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  sessionById: new Map<SessionId, SessionDetail>(),
  missingSessionIds: new Set<SessionId>(),
  draftSession: null,
  activeSessionId: null,
  activeSession: null,
  error: null,
  ...createChatActions(set, get),
}))

/*
 * Leaving a Session ends its pending send (ADR 0036). One its transcript never held (the reader
 * left before the workspace loaded) would otherwise hold a long-finished message on the next visit
 * and discard the saved reading position. A draft's send is not left: `activeSessionId` moves from
 * `null` straight to the Session it creates, and the send moves with it.
 */
useChatStore.subscribe((state, previous) => {
  const left = previous.activeSessionId
  if (left !== null && state.activeSessionId !== left) {
    usePendingSendStore.getState().clearSession(left)
  }
})
