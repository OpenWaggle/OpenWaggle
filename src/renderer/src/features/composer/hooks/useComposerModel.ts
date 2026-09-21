import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

/**
 * Existing Sessions execute with the immutable model captured in their execution profile.
 * The global preference only selects the model for a new Session.
 */
export function useComposerModel() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const sessionModel = useChatStore((state) => state.activeSession?.executionModel)
  const draftModel = useChatStore((state) => state.draftSession?.selectedModel)
  const preferredModel = usePreferencesStore((state) => state.settings.selectedModel)
  return {
    model: activeSessionId === null ? (draftModel ?? preferredModel) : sessionModel,
    isSessionModel: activeSessionId !== null,
  }
}
