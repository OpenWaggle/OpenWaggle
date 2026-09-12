import { SessionId } from '@shared/types/brand'
import { useEffect, useLayoutEffect } from 'react'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { buildComposerDraftContextKey } from '../lib/composer-draft-context'
import { setEditorDraft } from '../lib/lexical-utils'

type SessionStoreState = ReturnType<typeof useSessionStore.getState>
type ActiveWorkspace = SessionStoreState['activeWorkspace']
type DraftBranch = SessionStoreState['draftBranch']

function syncEditorDraft(draft: {
  readonly input: string
  readonly wagglePreset?: ReturnType<typeof useComposerStore.getState>['selectedWagglePreset']
}) {
  const editor = useComposerStore.getState().lexicalEditor
  if (editor) {
    setEditorDraft(editor, draft.input, draft.wagglePreset ?? null)
  }
}

function currentDraftOverride() {
  const prompt = useBranchSummaryStore.getState().prompt
  if (!prompt) {
    return undefined
  }
  return {
    input: prompt.draftComposerText,
    attachments: useComposerStore.getState().attachments,
    wagglePreset: useComposerStore.getState().selectedWagglePreset,
  }
}

export function useScopedComposerDrafts(activeSessionId: SessionId | null) {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const activeDraftContextKey = useComposerStore((state) => state.activeDraftContextKey)
  const pendingContextKey = `session:${activeSessionId}:pending`
  const contextKey =
    buildScopedComposerContextKey(projectPath, activeSessionId, activeWorkspace, draftBranch) ??
    pendingContextKey

  useLayoutEffect(() => {
    const previous = useComposerStore.getState()
    if (previous.activeDraftContextKey === contextKey) return

    // Lexical batches edits. Commit them through SyncPlugin before taking the draft
    // snapshot or changing its owner, otherwise hydration can overwrite a pending edit.
    previous.lexicalEditor?.read(() => undefined)
    const store = useComposerStore.getState()

    const pendingIsActive = store.activeDraftContextKey === pendingContextKey
    // Hydration assigns an edited pending draft, including an intentionally empty one,
    // to its branch. Preserve Lexical chips and selection when the same draft is visible.
    if (
      contextKey !== pendingContextKey &&
      (store.editedPendingDrafts[pendingContextKey] ||
        store.scopedDrafts[pendingContextKey] ||
        (pendingIsActive &&
          (store.input.length > 0 || store.attachments.length > 0 || store.selectedWagglePreset)))
    ) {
      const draft = pendingIsActive
        ? {
            input: store.input,
            attachments: store.attachments,
            wagglePreset: store.selectedWagglePreset,
          }
        : store.switchScopedDraftContext(pendingContextKey, undefined, currentDraftOverride())
      store.setActiveDraftContextKey(contextKey)
      store.saveScopedDraft(contextKey, draft)
      store.clearScopedDraft(pendingContextKey)
      if (!pendingIsActive) syncEditorDraft(draft)
      return
    }

    const appliedDraft = store.switchScopedDraftContext(
      contextKey,
      store.activeDraftContextKey === null
        ? {
            input: store.input,
            attachments: store.attachments,
            wagglePreset: store.selectedWagglePreset,
          }
        : undefined,
      currentDraftOverride(),
    )
    syncEditorDraft(appliedDraft)
  }, [contextKey, pendingContextKey])

  useEffect(() => {
    return () => {
      const store = useComposerStore.getState()
      if (store.activeDraftContextKey) {
        store.saveScopedDraft(
          store.activeDraftContextKey,
          currentDraftOverride() ?? {
            input: store.input,
            attachments: store.attachments,
            wagglePreset: store.selectedWagglePreset,
          },
        )
      }
    }
  }, [])

  // A session-owned pending draft remains editable before workspace hydration. Do not
  // expose the previous Session's draft while the layout effect switches ownership.
  return activeDraftContextKey === contextKey
}

function buildScopedComposerContextKey(
  projectPath: string | null,
  activeSessionId: SessionId | null,
  activeWorkspace: ActiveWorkspace,
  draftBranch: DraftBranch,
) {
  const scopedSessionId = activeSessionId ? SessionId(String(activeSessionId)) : null
  if (!workspaceBelongsToSession(activeWorkspace, scopedSessionId)) return null

  return buildComposerDraftContextKey({
    // Global project settings hydrate separately from the Session workspace.
    // Using them here can restore one key, then erase new input when they catch up.
    projectPath: scopedSessionId
      ? (activeWorkspace?.tree.session.projectPath ?? null)
      : projectPath,
    sessionId: scopedSessionId,
    activeBranchId: activeWorkspace?.activeBranchId ?? null,
    activeNodeId: activeWorkspace?.activeNodeId ?? null,
    draftSourceNodeId: getDraftSourceNodeId(draftBranch, scopedSessionId),
  })
}

function workspaceBelongsToSession(
  activeWorkspace: ActiveWorkspace,
  scopedSessionId: SessionId | null,
) {
  return !scopedSessionId || activeWorkspace?.tree.session.id === scopedSessionId
}

function getDraftSourceNodeId(draftBranch: DraftBranch, scopedSessionId: SessionId | null) {
  if (!draftBranch || !scopedSessionId) return null
  return draftBranch.sessionId === scopedSessionId ? draftBranch.sourceNodeId : null
}
