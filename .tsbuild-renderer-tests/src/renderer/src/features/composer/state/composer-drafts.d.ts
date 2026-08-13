import type { ComposerGet, ComposerScopedDraft, ComposerSet } from './composer-store-types';
export declare function normalizeScopedDraft(draft: ComposerScopedDraft): {
    input: string;
    attachments: import("../../../../../shared/types/agent").AttachmentRecord[];
};
export declare function removeScopedDraft(drafts: Readonly<Record<string, ComposerScopedDraft>>, contextKey: string): {
    [x: string]: ComposerScopedDraft;
};
export declare function createScopedDraftActions(set: ComposerSet, get: ComposerGet): {
    setActiveDraftContextKey(contextKey: string | null): void;
    switchScopedDraftContext(contextKey: string, fallbackDraft?: ComposerScopedDraft, currentDraftOverride?: ComposerScopedDraft): {
        input: string;
        attachments: import("../../../../../shared/types/agent").AttachmentRecord[];
    };
    saveScopedDraft(contextKey: string, draft: ComposerScopedDraft): void;
    getScopedDraft(contextKey: string): ComposerScopedDraft;
    clearScopedDraft(contextKey: string): void;
    clearScopedDraftsForSession(sessionId: string): void;
    clearScopedDraftsForBranch(sessionId: string, branchId: string): void;
};
