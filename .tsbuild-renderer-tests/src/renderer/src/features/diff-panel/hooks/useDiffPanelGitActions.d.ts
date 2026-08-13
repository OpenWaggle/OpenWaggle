interface UseDiffPanelGitActionsOptions {
    readonly projectPath: string | null;
    readonly fallbackHasChanges: boolean;
    /** Working-tree mutations are only valid when the panel shows the working tree. */
    readonly canMutateWorkingTree: boolean;
    readonly refreshDiff: (projectPath: string) => Promise<void>;
}
export declare function useDiffPanelGitActions({ projectPath, fallbackHasChanges, canMutateWorkingTree, refreshDiff, }: UseDiffPanelGitActionsOptions): {
    canRevertAll: boolean;
    canStageAll: boolean;
    isActionRunning: boolean;
    handleRevertAll: () => void;
    handleStageAll: () => void;
};
export {};
