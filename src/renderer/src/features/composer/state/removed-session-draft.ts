import type { SessionId } from '@shared/types/brand'
import { usePreferencesStore } from '@/features/settings/state'
import {
  buildComposerDraftContextKey,
  buildPendingSessionDraftContextKey,
} from '../lib/composer-draft-context'
import { useComposerStore } from './composer-store'

function ownedBySession(contextKey: string | null, sessionId: SessionId) {
  if (!contextKey) return false
  return (
    contextKey.includes(`:session:${String(sessionId)}:`) ||
    contextKey === buildPendingSessionDraftContextKey(sessionId)
  )
}

function joined(first: string, second: string) {
  return first && second ? `${first}\n\n${second}` : first || second
}

/** Sessions the user is deleting, as removing their project does: their drafts go with them. */
const forgoneSessions = new Set<string>()

/**
 * The draft of a Session the user is deleting is not carried once the Host reports it gone.
 * Returns what forgets that: for a deletion that failed, as the Session stays and so does its
 * draft, and once the deletion is done, so no id is kept for it.
 */
export function forgoRemovedSessionDraft(sessionId: SessionId) {
  forgoneSessions.add(String(sessionId))
  return () => {
    forgoneSessions.delete(String(sessionId))
  }
}

/**
 * The Host removed the open Session, as one whose Pi file was deleted: the view goes to New
 * session, and the draft written in it goes along, so text a refused send gave back is not lost.
 * Joined to a New session draft already there, in the project that is open.
 */
export function carryRemovedSessionDraft(
  sessionId: SessionId,
  /** The text written in it, when the composer shows something else, as summary instructions. */
  draftText?: string,
) {
  if (forgoneSessions.delete(String(sessionId))) return
  const store = useComposerStore.getState()
  const projectPath = usePreferencesStore.getState().settings.projectPath
  if (!ownedBySession(store.activeDraftContextKey, sessionId)) return
  const input = draftText ?? store.input
  if (!input.trim() && store.attachments.length === 0) return
  const target = buildComposerDraftContextKey({ projectPath, sessionId: null })
  const existing = store.getScopedDraft(target)
  const attachments = [...(existing?.attachments ?? []), ...store.attachments]
  store.saveScopedDraft(target, {
    input: joined(existing?.input ?? '', input),
    attachments: [
      ...new Map(attachments.map((attachment) => [attachment.id, attachment])).values(),
    ],
    wagglePreset: store.selectedWagglePreset ?? existing?.wagglePreset ?? null,
  })
}
