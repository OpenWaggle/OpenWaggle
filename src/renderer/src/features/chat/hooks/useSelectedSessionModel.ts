import type { SupportedModelId } from '@shared/types/llm'
import { useCallback } from 'react'
import { useChatStore } from '@/features/chat/state'
import { useDraftSelectedModelStore } from '@/features/chat/state/draft-selected-model-store'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-model')

/**
 * The model of the session the composer is acting on — stored per session in the database, never
 * globally. Resolution order: the session's own pick, then an explicit pre-first-send draft pick,
 * then the global default (which is only a default for sessions that never picked).
 */
export function useSelectedSessionModel(): {
  readonly selectedModel: SupportedModelId
  readonly setSelectedModel: (model: SupportedModelId) => Promise<void>
} {
  const activeSession = useChatStore((s) => s.activeSession)
  const draftProjectPath = useChatStore((s) => s.draftSession?.projectPath ?? null)
  const fallbackModel = usePreferencesStore((s) => s.settings.selectedModel)

  const projectPath = activeSession?.projectPath ?? draftProjectPath
  const draftModel = useDraftSelectedModelStore((s) =>
    projectPath ? s.byProjectPath[projectPath] : undefined,
  )

  const selectedModel = activeSession?.selectedModel ?? draftModel ?? fallbackModel

  const setSelectedModel = useCallback(async (model: SupportedModelId) => {
    const state = useChatStore.getState()
    if (state.activeSessionId) {
      const session = state.activeSession
      // Optimistic: the picker closes before the IPC write lands and the send gate reads this
      // store, so an awaited write would let an immediate submit dispatch the previous model.
      if (session) state.upsertSession({ ...session, selectedModel: model })
      try {
        await api.setSessionSelectedModel(state.activeSessionId, model)
      } catch (error) {
        // Roll back only if the user has not already picked something else meanwhile.
        const current = useChatStore.getState().activeSession
        if (session && current && current.id === session.id && current.selectedModel === model) {
          useChatStore
            .getState()
            .upsertSession({ ...current, selectedModel: session.selectedModel })
        }
        logger.warn('Session model selection failed; rolled back', {
          model: String(model),
          error: String(error),
        })
      }
      return
    }
    const draftProject = state.draftSession?.projectPath
    if (draftProject) {
      useDraftSelectedModelStore.getState().setOverride(draftProject, model)
      return
    }
    logger.warn('Ignored model selection outside any session or draft', {
      model: String(model),
    })
  }, [])

  return { selectedModel, setSelectedModel }
}
