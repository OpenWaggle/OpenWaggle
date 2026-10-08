import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import {
  isModelActionable,
  latestAnsweringModel,
  modelActionError,
} from '@/features/providers/state'
import { useChatStore } from '../state/chat-store'

/**
 * Why a Session cannot send on `model`, counting the fallback its Runs would take: a model the
 * catalog lacks runs on the model that answered the Session last.
 */
export function sessionModelActionError(
  session: SessionDetail | null,
  model: SupportedModelId | undefined,
) {
  return modelActionError(model, latestAnsweringModel(session?.messages ?? []))
}

/**
 * Whether a Session can act on `model`: send, switch branches, fork, clone, navigate or compact.
 * Like a send, each falls back on the Host to the model that answered last when `model` is gone.
 */
export function isSessionModelActionable(
  sessionId: SessionId | null | undefined,
  model: SupportedModelId | undefined,
): model is SupportedModelId {
  const { sessionById, activeSession } = useChatStore.getState()
  const session = sessionId
    ? (sessionById.get(sessionId) ?? (activeSession?.id === sessionId ? activeSession : null))
    : null
  return isModelActionable(model, latestAnsweringModel(session?.messages ?? []))
}
