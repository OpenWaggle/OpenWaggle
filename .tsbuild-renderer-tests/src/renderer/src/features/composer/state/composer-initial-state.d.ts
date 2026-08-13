import type { InitialComposerState } from './composer-store-types';
export declare function buildInitialComposerState(): {
    input: string;
    cursorIndex: number;
    promptHistory: string[];
    historyIndex: number;
    draftInput: string;
    attachments: never[];
    attachmentError: null;
    activeDraftContextKey: null;
    scopedDrafts: {};
    thinkingMenuOpen: boolean;
    executionMenuOpen: boolean;
    branchMenuOpen: boolean;
    slashHighlightIndex: number;
    dismissedSlashToken: null;
};
export declare const INITIAL_COMPOSER_STATE: InitialComposerState;
