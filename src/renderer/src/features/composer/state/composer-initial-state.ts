import { loadPromptHistory } from './composer-history'
import type { InitialComposerState } from './composer-store-types'

export function buildInitialComposerState() {
  const loaded = loadPromptHistory()
  return {
    input: '',
    cursorIndex: 0,
    promptHistory: loaded,
    historyIndex: loaded.length,
    draftInput: '',
    attachments: [],
    attachmentError: null,
    activeDraftContextKey: null,
    scopedDrafts: {},
    thinkingMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
    slashHighlightIndex: 0,
    dismissedSlashToken: null,
  }
}

export const INITIAL_COMPOSER_STATE: InitialComposerState = buildInitialComposerState()
