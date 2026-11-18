import type { PreparedAttachment } from '@shared/types/agent'
import type { WagglePreset } from '@shared/types/waggle'
import type { LexicalEditor } from 'lexical'
import { createScopedDraftActions, removeScopedDraft } from './composer-drafts'
import { createHistoryActions } from './composer-history'
import { INITIAL_COMPOSER_STATE } from './composer-initial-state'
import { markPendingDraftEdited } from './composer-pending-draft'
import type { ComposerGet, ComposerSet, ComposerState, MenuKind } from './composer-store-types'

export function createComposerStoreState(set: ComposerSet, get: ComposerGet) {
  return {
    ...INITIAL_COMPOSER_STATE,
    ...createTextActions(set),
    ...createHistoryActions(set, get),
    ...createAttachmentActions(set),
    setSelectedWagglePreset(preset: WagglePreset | null) {
      set((state) => ({
        selectedWagglePreset: preset,
        editedPendingDrafts:
          state.selectedWagglePreset === preset
            ? state.editedPendingDrafts
            : markPendingDraftEdited(state),
      }))
    },
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
      set((state) => ({
        input: value,
        editedPendingDrafts:
          state.input === value ? state.editedPendingDrafts : markPendingDraftEdited(state),
      }))
    },

    setCursorIndex(index: number) {
      set({ cursorIndex: index })
    },
  }
}

function createAttachmentActions(set: ComposerSet) {
  return {
    addAttachments(files: PreparedAttachment[]) {
      set((state) => ({
        attachments: [...state.attachments, ...files],
        editedPendingDrafts:
          files.length > 0 ? markPendingDraftEdited(state) : state.editedPendingDrafts,
      }))
    },

    replaceAttachments(files: readonly PreparedAttachment[]) {
      set((state) => ({
        attachments: [...files],
        editedPendingDrafts:
          files.length !== state.attachments.length ||
          files.some((file, index) => file !== state.attachments[index])
            ? markPendingDraftEdited(state)
            : state.editedPendingDrafts,
      }))
    },

    removeAttachment(id: string) {
      set((state) => ({
        attachments: state.attachments.filter((attachment) => attachment.id !== id),
        editedPendingDrafts: state.attachments.some((attachment) => attachment.id === id)
          ? markPendingDraftEdited(state)
          : state.editedPendingDrafts,
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

    setActiveSlashCommand(match: ComposerState['activeSlashCommand']) {
      set({ activeSlashCommand: match })
    },

    setDismissedSlashToken(token: string | null) {
      set({ dismissedSlashToken: token })
    },

    setSlashMenuFilter(filter: ComposerState['slashMenuFilter']) {
      set({ slashMenuFilter: filter })
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
    selectedWagglePreset: null,
    dismissedSlashToken: null,
    slashHighlightIndex: 0,
    activeSlashCommand: null,
    slashMenuFilter: 'all',
    thinkingMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
    scopedDrafts: activeDraftContextKey
      ? removeScopedDraft(scopedDrafts, activeDraftContextKey)
      : scopedDrafts,
  })
}
