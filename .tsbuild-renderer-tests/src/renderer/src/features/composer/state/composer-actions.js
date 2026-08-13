import { createScopedDraftActions, removeScopedDraft } from './composer-drafts';
import { createHistoryActions } from './composer-history';
import { INITIAL_COMPOSER_STATE } from './composer-initial-state';
export function createComposerStoreState(set, get) {
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
    };
}
function createTextActions(set) {
    return {
        setInput(value) {
            set({ input: value });
        },
        setCursorIndex(index) {
            set({ cursorIndex: index });
        },
    };
}
function createAttachmentActions(set) {
    return {
        addAttachments(files) {
            set((state) => ({ attachments: [...state.attachments, ...files] }));
        },
        replaceAttachments(files) {
            set({ attachments: [...files] });
        },
        removeAttachment(id) {
            set((state) => ({
                attachments: state.attachments.filter((attachment) => attachment.id !== id),
            }));
        },
        setAttachmentError(error) {
            set({ attachmentError: error });
        },
    };
}
function createMenuActions(set) {
    return {
        openMenu(menu) {
            set({
                thinkingMenuOpen: menu === 'thinking',
                executionMenuOpen: menu === 'execution',
                branchMenuOpen: menu === 'branch',
            });
        },
    };
}
function createSlashSkillActions(set) {
    return {
        setSlashHighlightIndex(index) {
            set({ slashHighlightIndex: index });
        },
        setDismissedSlashToken(token) {
            set({ dismissedSlashToken: token });
        },
    };
}
function createEditorActions(set) {
    return {
        lexicalEditor: null,
        setLexicalEditor(editor) {
            set({ lexicalEditor: editor });
        },
    };
}
function resetComposerState(set, get) {
    const { activeDraftContextKey, promptHistory, scopedDrafts } = get();
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
    });
}
