import { SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { buildComposerDraftContextKey } from '../lib/composer-draft-context'
import { setEditorText } from '../lib/lexical-utils'

type SessionStoreState = ReturnType<typeof useSessionStore.getState>
type ActiveWorkspace = SessionStoreState['activeWorkspace']
type DraftBranch = SessionStoreState['draftBranch']

function syncEditorText(text: string) {
  const editor = useComposerStore.getState().lexicalEditor
  if (editor) {
    setEditorText(editor, text)
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
  }
}

export function useScopedComposerDrafts(activeSessionId: SessionId | null) {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const contextKey = buildScopedComposerContextKey(
    projectPath,
    activeSessionId,
    activeWorkspace,
    draftBranch,
  )

  useEffect(() => {
    if (!contextKey) {
      return
    }

    const appliedDraft = useComposerStore
      .getState()
      .switchScopedDraftContext(contextKey, undefined, currentDraftOverride())
    syncEditorText(appliedDraft.input)
  }, [contextKey])

  useEffect(() => {
    return () => {
      const store = useComposerStore.getState()
      if (store.activeDraftContextKey) {
        store.saveScopedDraft(
          store.activeDraftContextKey,
          currentDraftOverride() ?? {
            input: store.input,
            attachments: store.attachments,
          },
        )
      }
    }
  }, [])
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
    projectPath,
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
