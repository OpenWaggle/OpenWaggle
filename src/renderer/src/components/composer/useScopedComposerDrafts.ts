import { type ConversationId, SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { type ComposerScopedDraft, useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStore } from '@/stores/session-store'
import { buildComposerDraftContextKey } from './composer-draft-context'
import { setEditorText } from './lexical-utils'

function syncEditorText(text: string): void {
  const editor = useComposerStore.getState().lexicalEditor
  if (editor) {
    setEditorText(editor, text)
  }
}

function currentDraftOverride(): ComposerScopedDraft | undefined {
  const prompt = useBranchSummaryStore.getState().prompt
  if (!prompt) {
    return undefined
  }
  return {
    input: prompt.draftComposerText,
    attachments: useComposerStore.getState().attachments,
  }
}

export function useScopedComposerDrafts(activeConversationId: ConversationId | null): void {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)

  const activeSessionId = activeConversationId ? SessionId(String(activeConversationId)) : null
  const workspaceBelongsToSession =
    !activeSessionId || activeWorkspace?.tree.session.id === activeSessionId
  const draftSourceNodeId =
    draftBranch && activeSessionId && draftBranch.sessionId === activeSessionId
      ? draftBranch.sourceNodeId
      : null
  const contextKey = workspaceBelongsToSession
    ? buildComposerDraftContextKey({
        projectPath,
        sessionId: activeSessionId,
        activeBranchId: activeWorkspace?.activeBranchId ?? null,
        activeNodeId: activeWorkspace?.activeNodeId ?? null,
        draftSourceNodeId,
      })
    : null

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
