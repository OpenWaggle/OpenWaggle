import { loadPromptHistory } from './composer-history';
export function buildInitialComposerState() {
    const loaded = loadPromptHistory();
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
    };
}
export const INITIAL_COMPOSER_STATE = buildInitialComposerState();
