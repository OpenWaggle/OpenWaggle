import type { ComposerState } from './composer-store-types'

// Keep edit intent even when the user clears every field before workspace hydration.
// Only pending contexts need this marker; resolved drafts already have a branch owner.
export function markPendingDraftEdited(state: ComposerState) {
  const key = state.activeDraftContextKey
  if (!key?.startsWith('session:') || !key.endsWith(':pending') || state.editedPendingDrafts[key]) {
    return state.editedPendingDrafts
  }
  return { ...state.editedPendingDrafts, [key]: true as const }
}
