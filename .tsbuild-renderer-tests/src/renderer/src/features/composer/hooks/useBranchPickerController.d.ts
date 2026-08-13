interface UseBranchPickerControllerInput {
    readonly onToast?: (message: string) => void;
}
export declare function useBranchPickerController({ onToast }: UseBranchPickerControllerInput): {
    projectPath: string | null;
    branchMenuOpen: boolean;
    branchQuery: string;
    currentBranch: string | null;
    isBranchActionRunning: boolean;
    filteredBranches: readonly import("@shared/types/git").GitBranchInfo[];
    localBranches: import("@shared/types/git").GitBranchInfo[];
    remoteBranches: import("@shared/types/git").GitBranchInfo[];
    openMenu: (menu: import("../state/composer-store-types").MenuKind) => void;
    setBranchQuery: (query: string) => void;
    openActionDialog: (kind: import("@/features/composer/state/composer-action-store").ComposerActionDialogKind, initialValue?: string) => void;
    checkoutBranch: (name: string) => Promise<void>;
};
export {};
