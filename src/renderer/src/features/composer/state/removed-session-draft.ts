import type { SessionId } from '@shared/types/brand'
import { usePreferencesStore } from '@/features/settings/state'
import {
  buildComposerDraftContextKey,
  buildPendingSessionDraftContextKey,
} from '../lib/composer-draft-context'
import { useComposerStore } from './composer-store'
import type { ComposerScopedDraft } from './composer-store-types'

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
 * Returns what undoes that, for a deletion that failed: the Session stays, and so does its draft.
 */
export function forgoRemovedSessionDraft(sessionId: SessionId) {
  forgoneSessions.add(String(sessionId))
  return () => {
    forgoneSessions.delete(String(sessionId))
  }
}

/**
 * The draft the composer shows for the Session, and one the Session owns before its workspace is
 * shown, as a branch summary that could not be shown leaves.
 */
function sessionDrafts(sessionId: SessionId, draftText: string | undefined): ComposerScopedDraft[] {
  const store = useComposerStore.getState()
  const pendingKey = buildPendingSessionDraftContextKey(sessionId)
  const shown = ownedBySession(store.activeDraftContextKey, sessionId)
  const pending =
    store.activeDraftContextKey === pendingKey ? null : store.getScopedDraft(pendingKey)
  return [
    ...(pending ? [pending] : []),
    ...(shown
      ? [
          {
            input: draftText ?? store.input,
            attachments: store.attachments,
            wagglePreset: store.selectedWagglePreset,
          },
        ]
      : []),
  ]
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
  const drafts = sessionDrafts(sessionId, draftText)
  store.clearScopedDraft(buildPendingSessionDraftContextKey(sessionId))
  const input = drafts.map((draft) => draft.input).reduce(joined, '')
  const carried = drafts.flatMap((draft) => draft.attachments)
  if (!input.trim() && carried.length === 0) return
  const projectPath = usePreferencesStore.getState().settings.projectPath
  const target = buildComposerDraftContextKey({ projectPath, sessionId: null })
  const existing = store.getScopedDraft(target)
  const attachments = [...(existing?.attachments ?? []), ...carried]
  store.saveScopedDraft(target, {
    input: joined(existing?.input ?? '', input),
    attachments: [
      ...new Map(attachments.map((attachment) => [attachment.id, attachment])).values(),
    ],
    wagglePreset:
      [...drafts].reverse().find((draft) => draft.wagglePreset)?.wagglePreset ??
      existing?.wagglePreset ??
      null,
  })
}
