import { matchBy } from '@diegogbrisa/ts-match'
import {
  isNonBlankSessionTitle,
  normalizeSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
} from '@shared/session-title'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionTitleRegenerationResult,
  SessionTitleRegenerationUnavailableReason,
} from '@shared/types/session-title'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { useUIStore } from '@/shell/ui-store'
import { useSessionTitleRegenerationStore } from '../state/session-title-regeneration-store'

const UNAVAILABLE_MESSAGES = {
  off: 'Title generation is off. Choose a Title model in Settings to regenerate titles.',
  empty: 'This session has nothing to title yet.',
  'no-model': 'No model can write this title. Choose a Title model in Settings › Connections.',
  busy: 'A title is already being generated for this session.',
} satisfies Record<SessionTitleRegenerationUnavailableReason, string>

export const SessionTitleMessages = {
  regenerating: 'Regenerating the title…',
  unchanged: 'The current title already fits this session.',
  unavailable: UNAVAILABLE_MESSAGES,
} as const

/**
 * Show a title in every renderer store that holds it, without reloading the catalog and without
 * touching `updatedAt`: a title change never moves a Session in the sidebar (ADR 0043).
 */
function applySessionTitleLocally(sessionId: SessionId, title: string) {
  useSessionStore.getState().applySessionTitle(sessionId, title)
  useChatStore.getState().applySessionTitle(sessionId, title)
}

function currentSessionTitle(sessionId: SessionId) {
  const sessions = useSessionStore.getState()
  if (sessions.activeSessionTree?.session.id === sessionId) {
    return sessions.activeSessionTree.session.title
  }
  return (
    sessions.sessions.find((session) => session.id === sessionId)?.title ??
    useChatStore.getState().sessionById.get(sessionId)?.title ??
    null
  )
}

/**
 * The title a rename would save, or null when the edit should cancel without IPC: blank,
 * unchanged, or longer than a Session title may be.
 */
export function resolveRenamedSessionTitle(previousTitle: string, draft: string) {
  const title = normalizeSessionTitle(draft)
  if (!isNonBlankSessionTitle(title)) return null
  if (title.length > SESSION_TITLE_MAX_LENGTH) return null
  if (title === normalizeSessionTitle(previousTitle)) return null
  return title
}

/**
 * Rename a Session optimistically. The Host marks the title manual so generation never replaces
 * it. `baseline` is the title the edit started from: a draft equal to it is no rename, even when a
 * generated title replaced it meanwhile. If the Host rejects the rename, the title shown when the
 * edit ended comes back, unless something newer already replaced the optimistic one.
 */
export async function renameSession(
  sessionId: SessionId,
  titles: { readonly baseline: string; readonly current: string },
  draft: string,
) {
  const title = resolveRenamedSessionTitle(titles.baseline, draft)
  if (title === null) return
  applySessionTitleLocally(sessionId, title)
  try {
    await api.updateSessionTitle(sessionId, title)
  } catch (error) {
    if (currentSessionTitle(sessionId) === title) {
      applySessionTitleLocally(sessionId, titles.current)
    }
    useUIStore.getState().showToast(`Failed to rename session: ${ipcErrorMessage(error)}`, 'error')
  }
}

function reportRegenerationResult(sessionId: SessionId, result: SessionTitleRegenerationResult) {
  const { showToast } = useUIStore.getState()
  matchBy(result, 'outcome')
    .with('renamed', ({ title }) => applySessionTitleLocally(sessionId, title))
    .with('unchanged', () => showToast(SessionTitleMessages.unchanged))
    .with('superseded', () => undefined)
    .with('unavailable', ({ reason }) => showToast(UNAVAILABLE_MESSAGES[reason]))
    .with('failed', ({ message }) =>
      showToast(`Couldn't regenerate the title: ${message}`, 'error'),
    )
    .exhaustive()
}

/** Run one Title regeneration; a second request for the same Session while one runs is ignored. */
export async function regenerateSessionTitle(sessionId: SessionId) {
  const regeneration = useSessionTitleRegenerationStore.getState()
  if (!regeneration.begin(sessionId)) return
  // The menu closes at once, so a persistent toast says the request is running. It clears when
  // the request ends unless an outcome toast has already replaced it.
  const progress = { message: SessionTitleMessages.regenerating, variant: 'neutral' } as const
  useUIStore.getState().showPersistentToast(progress)
  const clearProgress = () => {
    if (useUIStore.getState().toastData === progress) useUIStore.getState().clearToast()
  }
  try {
    const result = await api.regenerateSessionTitle(sessionId)
    clearProgress()
    reportRegenerationResult(sessionId, result)
  } catch (error) {
    clearProgress()
    useUIStore
      .getState()
      .showToast(`Couldn't regenerate the title: ${ipcErrorMessage(error)}`, 'error')
  } finally {
    regeneration.finish(sessionId)
  }
}
