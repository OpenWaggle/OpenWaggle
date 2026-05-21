import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { create } from 'zustand'
import { createChatActions } from './chat-store-actions'
import type { ChatState } from './chat-store-types'

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
