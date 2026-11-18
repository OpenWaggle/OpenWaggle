import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { useUIStore } from '@/shell/ui-store'
import { handleStoreError } from './chat-store-helpers'
import type { ChatState } from './chat-store-types'
import { writeSessionModel } from './session-model-writes'

export { withPendingSessionModel } from './session-model-writes'

type ChatSet = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
type ChatGet = () => ChatState

function applySessionModel(id: SessionId, model: SupportedModelId, set: ChatSet) {
  set((state) => {
    const existing = state.sessionById.get(id)
    const active = state.activeSessionId === id ? state.activeSession : null
    if (existing?.executionModel === model && (!active || active.executionModel === model)) {
      return {}
    }
    const sessionById = new Map(state.sessionById)
    if (existing) sessionById.set(id, { ...existing, executionModel: model })
    return {
      sessionById,
      ...(active ? { activeSession: { ...active, executionModel: model } } : {}),
    }
  })
}

/** Shows the pick at once, stores it through the Session Host, and rolls back on rejection. */
function setSessionModel(id: SessionId, model: SupportedModelId, set: ChatSet, get: ChatGet) {
  const current = get()
  const previous =
    current.sessionById.get(id) ?? (current.activeSessionId === id ? current.activeSession : null)
  return writeSessionModel({
    sessionId: id,
    model,
    previousModel: previous?.executionModel,
    applyModel: (next) => {
      applySessionModel(id, next, set)
    },
    refresh: () => get().refreshSession(id),
    onError: (error) => {
      handleStoreError(error, 'switch the Session model', (message) => set({ error: message }))
      const reason = error instanceof Error ? error.message : String(error)
      useUIStore.getState().showToast(`Could not switch the Session model: ${reason}`, 'error')
    },
  })
}

export function createSessionModelActions(set: ChatSet, get: ChatGet) {
  return {
    setSessionModel: (id: SessionId, model: SupportedModelId) =>
      setSessionModel(id, model, set, get),
  }
}
