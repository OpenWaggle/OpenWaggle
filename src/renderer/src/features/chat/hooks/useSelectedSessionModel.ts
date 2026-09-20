import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { refreshSessionStoreForSession } from '@/features/chat/state/chat-store-helpers'
import { useDraftSelectedModelStore } from '@/features/chat/state/draft-selected-model-store'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  clearDesiredSessionModel,
  commitDesiredSessionModel,
  markDesiredSessionModel,
  reconcileSessionModelPick,
  runExclusiveSessionModelWrite,
} from '@/shared/lib/session-model-pick'

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
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const draftProjectPath = useChatStore((s) => s.draftSession?.projectPath ?? null)
  const fallbackModel = usePreferencesStore((s) => s.settings.selectedModel)

  // While an opened session's detail is still loading (id set, detail null), the summaries carry
  // its stored pick; without this the composer would briefly resolve the global default and an
  // immediate send would run the session on the wrong model.
  const summaryModel = useSessionStore((s) =>
    activeSessionId && activeSession === null
      ? s.sessions.find((summary) => String(summary.id) === String(activeSessionId))?.selectedModel
      : undefined,
  )

  // Draft picks apply only while no session is active: the draft is the composer's target until
  // the first send creates the session, whose own row (or the global default) takes over. A pick
  // made in an abandoned draft must not leak into an existing session that never picked.
  const draftModel = useDraftSelectedModelStore((s) =>
    activeSession === null && draftProjectPath
      ? s.byProjectPath[draftProjectPath]?.model
      : undefined,
  )

  const selectedModel = activeSession
    ? (activeSession.selectedModel ?? fallbackModel)
    : activeSessionId
      ? (summaryModel ?? fallbackModel)
      : (draftModel ?? fallbackModel)

  const setSelectedModel = async (model: SupportedModelId) => {
    const state = useChatStore.getState()
    if (state.activeSessionId) {
      const sessionId = state.activeSessionId
      const session = state.activeSession
      const sessionKey = String(sessionId)
      const pickGeneration = markDesiredSessionModel(sessionKey, model)
      // Optimistic: the picker closes before the IPC write lands and the send gate reads the
      // chat store, so an awaited write would let an immediate submit dispatch the previous
      // model. The summary is patched too: branch navigation reads the summaries, not the detail.
      if (session) state.upsertSession({ ...session, selectedModel: model })
      useSessionStore.setState((s) => ({
        sessions: s.sessions.map((summary) =>
          String(summary.id) === sessionKey ? { ...summary, selectedModel: model } : summary,
        ),
      }))
      await runExclusiveSessionModelWrite(sessionKey, async () => {
        try {
          await api.setSessionSelectedModel(sessionId, model)
          commitDesiredSessionModel(sessionKey, model, pickGeneration)
        } catch (error) {
          logger.warn('Session model selection failed; reloading persisted state', {
            model: String(model),
            error: String(error),
          })
          // Drop this pick's guard so the rollback writes the persisted row; a newer pick's
          // guard stays and keeps its optimistic value through the rollback.
          clearDesiredSessionModel(sessionKey, pickGeneration)
          try {
            const fresh = await api.getSessionDetail(sessionId)
            if (fresh) {
              useChatStore.getState().upsertSession(fresh)
              // Roll the summary back directly from the fresh row: the async list refresh is
              // best-effort and can itself fail, which would keep the rejected model there.
              // Reconciled, so a newer pick's optimistic summary survives this rollback.
              useSessionStore.setState((s) => ({
                sessions: s.sessions.map((summary) =>
                  String(summary.id) === sessionKey
                    ? reconcileSessionModelPick({ ...summary, selectedModel: fresh.selectedModel })
                    : summary,
                ),
              }))
              refreshSessionStoreForSession(sessionId, useChatStore.getState().activeSessionId)
            } else {
              await useChatStore.getState().refreshSession(sessionId)
            }
          } catch (reloadError) {
            // The write and the reload both failed (same outage): restore the pre-pick detail and
            // summary so nothing keeps a model that was never persisted. Both pass through the
            // desired-pick guard, so a newer pick's optimistic value survives this rollback.
            logger.warn('Reloading after a failed model pick failed; restoring pre-pick state', {
              model: String(model),
              error: String(reloadError),
            })
            if (session) useChatStore.getState().upsertSession(session)
            useSessionStore.setState((s) => ({
              sessions: s.sessions.map((summary) =>
                String(summary.id) === sessionKey
                  ? reconcileSessionModelPick({ ...summary, selectedModel: session?.selectedModel })
                  : summary,
              ),
            }))
          }
          return
        }
        // Late detail/summary refreshes are reconciled by the guard, not here. Sync the
        // projection (and the tree when this is the open session) so readers leave the stale row.
        refreshSessionStoreForSession(sessionId, useChatStore.getState().activeSessionId)
      })
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
  }

  return { selectedModel, setSelectedModel }
}
