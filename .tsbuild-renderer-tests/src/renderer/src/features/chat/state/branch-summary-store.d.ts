import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand';
export type BranchSummaryPromptMode = 'choice' | 'custom' | 'summarizing';
export interface BranchSummaryRestoreSelection {
    readonly branchId: SessionBranchId | null;
    readonly nodeId: SessionNodeId | null;
}
export interface BranchSummaryPromptState {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
    readonly restoreSelection: BranchSummaryRestoreSelection;
    readonly previousComposerText: string;
    readonly draftComposerText: string;
    readonly mode: BranchSummaryPromptMode;
}
interface OpenBranchSummaryPromptInput {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
    readonly restoreSelection: BranchSummaryRestoreSelection;
    readonly previousComposerText: string;
    readonly draftComposerText: string;
}
interface BranchSummaryStoreState {
    readonly prompt: BranchSummaryPromptState | null;
    readonly openPrompt: (input: OpenBranchSummaryPromptInput) => void;
    readonly startCustomPrompt: (draftComposerText: string) => void;
    readonly startSummarizing: () => void;
    readonly restoreChoice: () => void;
    readonly clearPrompt: () => void;
}
export declare const useBranchSummaryStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<BranchSummaryStoreState>>;
export {};
