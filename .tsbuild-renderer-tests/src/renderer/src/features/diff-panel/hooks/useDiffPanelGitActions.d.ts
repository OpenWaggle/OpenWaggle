interface UseDiffPanelGitActionsOptions {
    readonly workingPath: string | null;
    readonly fallbackHasChanges: boolean;
    /** Working-tree mutations are only valid when the panel shows the working tree. */
    readonly canMutateWorkingTree: boolean;
    readonly refreshDiff: (workingPath: string) => Promise<void>;
}
export declare function useDiffPanelGitActions({ workingPath, fallbackHasChanges, canMutateWorkingTree, refreshDiff, }: UseDiffPanelGitActionsOptions): {
    canRevertAll: boolean;
    canStageAll: boolean;
    isActionRunning: boolean;
    handleRevertAll: () => void;
    handleStageAll: () => void;
};
export {};
