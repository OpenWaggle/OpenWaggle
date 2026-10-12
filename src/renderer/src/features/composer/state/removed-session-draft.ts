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

/**
 * The Host removed the open Session, as one whose Pi file was deleted: the view goes to New
 * session, and the draft written in it goes along, so text a refused send gave back is not lost.
 * Joined to a New session draft already there, in the project that is open.
 */
export function carryRemovedSessionDraft(sessionId: SessionId) {
  const store = useComposerStore.getState()
  const projectPath = usePreferencesStore.getState().settings.projectPath
  if (!ownedBySession(store.activeDraftContextKey, sessionId)) return
  if (!store.input.trim() && store.attachments.length === 0) return
  const target = buildComposerDraftContextKey({ projectPath, sessionId: null })
  const existing = store.getScopedDraft(target)
  store.saveScopedDraft(target, {
    input: joined(existing?.input ?? '', store.input),
    attachments: [...(existing?.attachments ?? []), ...store.attachments],
    wagglePreset: store.selectedWagglePreset ?? existing?.wagglePreset ?? null,
  })
}
