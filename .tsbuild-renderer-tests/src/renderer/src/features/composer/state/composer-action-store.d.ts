export type ComposerActionDialogKind = 'create-branch';
interface ComposerActionState {
    actionDialog: ComposerActionDialogKind | null;
    actionDialogInput: string;
    actionDialogError: string | null;
    actionDialogBusy: boolean;
    openActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void;
    closeActionDialog: () => void;
    setActionDialogInput: (value: string) => void;
    setActionDialogError: (error: string | null) => void;
    setActionDialogBusy: (busy: boolean) => void;
    branchQuery: string;
    branchMessage: string | null;
    setBranchQuery: (query: string) => void;
    setBranchMessage: (message: string | null) => void;
}
export declare const useComposerActionStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<ComposerActionState>>;
export {};
