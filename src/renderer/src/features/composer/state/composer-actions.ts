import type { PreparedAttachment } from '@shared/types/agent'
import type { LexicalEditor } from 'lexical'
import { createScopedDraftActions, removeScopedDraft } from './composer-drafts'
import { createHistoryActions } from './composer-history'
import { INITIAL_COMPOSER_STATE } from './composer-initial-state'
import type { ComposerGet, ComposerSet, MenuKind } from './composer-store-types'

export function createComposerStoreState(set: ComposerSet, get: ComposerGet) {
  return {
    ...INITIAL_COMPOSER_STATE,
    ...createTextActions(set),
    ...createHistoryActions(set, get),
    ...createAttachmentActions(set),
    ...createScopedDraftActions(set, get),
    ...createMenuActions(set),
    ...createSlashSkillActions(set),
    ...createEditorActions(set),
    reset: () => resetComposerState(set, get),
  }
}

function createTextActions(set: ComposerSet) {
  return {
    setInput(value: string) {
      set({ input: value })
    },

    setCursorIndex(index: number) {
      set({ cursorIndex: index })
    },
  }
}

function createAttachmentActions(set: ComposerSet) {
  return {
    addAttachments(files: PreparedAttachment[]) {
      set((state) => ({ attachments: [...state.attachments, ...files] }))
    },

    replaceAttachments(files: readonly PreparedAttachment[]) {
      set({ attachments: [...files] })
    },

    removeAttachment(id: string) {
      set((state) => ({
        attachments: state.attachments.filter((attachment) => attachment.id !== id),
      }))
    },

    setAttachmentError(error: string | null) {
      set({ attachmentError: error })
    },
  }
}

function createMenuActions(set: ComposerSet) {
  return {
    openMenu(menu: MenuKind) {
      set({
        thinkingMenuOpen: menu === 'thinking',
        executionMenuOpen: menu === 'execution',
        branchMenuOpen: menu === 'branch',
      })
    },
  }
}

function createSlashSkillActions(set: ComposerSet) {
  return {
    setSlashHighlightIndex(index: number) {
      set({ slashHighlightIndex: index })
    },

    setDismissedSlashToken(token: string | null) {
      set({ dismissedSlashToken: token })
    },
  }
}

function createEditorActions(set: ComposerSet) {
  return {
    lexicalEditor: null,
    setLexicalEditor(editor: LexicalEditor | null) {
      set({ lexicalEditor: editor })
    },
  }
}

function resetComposerState(set: ComposerSet, get: ComposerGet) {
  const { activeDraftContextKey, promptHistory, scopedDrafts } = get()
  set({
    input: '',
    cursorIndex: 0,
    historyIndex: promptHistory.length,
    draftInput: '',
    attachments: [],
    attachmentError: null,
    dismissedSlashToken: null,
    slashHighlightIndex: 0,
    thinkingMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
    scopedDrafts: activeDraftContextKey
      ? removeScopedDraft(scopedDrafts, activeDraftContextKey)
      : scopedDrafts,
  })
}
