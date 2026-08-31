import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

/**
 * Existing Sessions execute with the immutable model captured in their execution profile.
 * The global preference only selects the model for a new Session.
 */
export function useComposerModel() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const sessionModel = useChatStore((state) => state.activeSession?.executionModel)
  const preferredModel = usePreferencesStore((state) => state.settings.selectedModel)
  return {
    model: sessionModel ?? preferredModel,
    isSessionModel: activeSessionId !== null,
  }
}
