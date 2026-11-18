import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

/**
 * The model the composer's next prompt uses.
 *
 * For an existing Session that is the Session's own durable model. It can change only while the
 * Session has no Run starting, active, or finishing (the Host refuses it otherwise), so a running
 * Run's model is the Session's; `runningModel` is the model that Run reported when it started.
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
  return { model, runningModel, isSessionModel: activeSessionId !== null }
}
