import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

/**
 * The model the composer's next prompt uses.
 *
 * For an existing Session that is the Session's own durable model, which the user can switch at any
 * time. A switch never reaches a Run that is already streaming: that Run keeps `runningModel`, the
 * model it started with, and the pick applies from the next prompt on (`appliesToNextMessage`).
 * A draft uses its own pick, then the project's preferred model for new Sessions.
 */
export function useComposerModel() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const sessionModel = useChatStore((state) => state.activeSession?.executionModel)
  const draftModel = useChatStore((state) => state.draftSession?.selectedModel)
  const preferredModel = usePreferencesStore((state) => state.settings.selectedModel)
  const runningModel = useBackgroundRunStore((state) =>
    activeSessionId ? state.runModelBySessionId.get(activeSessionId) : undefined,
  )
  const model = activeSessionId === null ? (draftModel ?? preferredModel) : sessionModel
  return {
    model,
    runningModel,
    appliesToNextMessage:
      runningModel !== undefined && model !== undefined && runningModel !== model,
    isSessionModel: activeSessionId !== null,
  }
}
