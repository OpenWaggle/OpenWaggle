import type { SupportedModelId } from '@shared/types/llm'
import { useChatStore } from '@/features/chat/state'
import { refreshSessionStoreForSession } from '@/features/chat/state/chat-store-helpers'
import { useDraftSelectedModelStore } from '@/features/chat/state/draft-selected-model-store'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-model')

/** One settled pick at a time per session, so overlapping writes reconcile in dispatch order. */
const pickQueues = new Map<string, Promise<void>>()
/** The newest pick per session, set synchronously so an older task's reconciliation stands down. */
const desiredModelBySession = new Map<string, SupportedModelId>()

async function runExclusive(sessionKey: string, task: () => Promise<void>): Promise<void> {
  const previous = pickQueues.get(sessionKey) ?? Promise.resolve()
  const current = previous.then(task, task)
  pickQueues.set(
    sessionKey,
    current.catch(() => undefined),
  )
  await current
}

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

  // Draft picks apply only while no session is active: the draft is the composer's target until
  // the first send creates the session, whose own row (or the global default) takes over. A pick
  // made in an abandoned draft must not leak into an existing session that never picked.
  const draftModel = useDraftSelectedModelStore((s) =>
    activeSession === null && draftProjectPath ? s.byProjectPath[draftProjectPath] : undefined,
  )

  const selectedModel = activeSession
    ? (activeSession.selectedModel ?? fallbackModel)
    : (draftModel ?? fallbackModel)

  const setSelectedModel = async (model: SupportedModelId) => {
    const state = useChatStore.getState()
    if (state.activeSessionId) {
      const sessionId = state.activeSessionId
      const session = state.activeSession
      const sessionKey = String(sessionId)
      desiredModelBySession.set(sessionKey, model)
      // Optimistic: the picker closes before the IPC write lands and the send gate reads this
      // store, so an awaited write would let an immediate submit dispatch the previous model.
      if (session) state.upsertSession({ ...session, selectedModel: model })
      await runExclusive(sessionKey, async () => {
        try {
          await api.setSessionSelectedModel(sessionId, model)
        } catch (error) {
          logger.warn('Session model selection failed; reloading persisted state', {
            model: String(model),
            error: String(error),
          })
          // Converge on the persisted row inside the queue, so a newer pick cannot start from a
          // cache this failed write is about to overwrite.
          await useChatStore.getState().refreshSession(sessionId)
          return
        }
        // A newer pick owns the cache and the summaries; its own settlement reconciles both.
        if (desiredModelBySession.get(sessionKey) !== model) return
        // Patch the summary synchronously: the refresh below is fire-and-forget, and a branch
        // selection in the same tick must not reconstruct the run from the stale row.
        useSessionStore.setState((s) => ({
          sessions: s.sessions.map((summary) =>
            String(summary.id) === String(sessionId)
              ? { ...summary, selectedModel: model }
              : summary,
          ),
        }))
        // Then sync the summaries projection (and the tree when this is the open session).
        refreshSessionStoreForSession(sessionId, useChatStore.getState().activeSessionId)
        // An in-flight session-detail refresh can restore the pre-pick value after the optimistic
        // upsert, and the next send reads this store — reapply the persisted model to the cache.
        const cached = useChatStore.getState().sessionById.get(sessionId)
        if (cached && cached.selectedModel !== model) {
          useChatStore.getState().upsertSession({ ...cached, selectedModel: model })
        }
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
