interface UseActionDialogControllerInput {
    readonly onToast?: (message: string) => void;
}
export declare function useActionDialogController({ onToast }: UseActionDialogControllerInput): {
    actionDialog: "create-branch" | null;
    actionDialogInput: string;
    actionDialogError: string | null;
    actionDialogBusy: boolean;
    closeActionDialog: () => void;
    setActionDialogInput: (value: string) => void;
    inputRef: import("node_modules/@types/react").RefObject<HTMLInputElement | null>;
    config: {
        readonly title: "Create branch";
        readonly description: "Create and checkout a new branch from the current HEAD.";
        readonly confirmLabel: "Create";
        readonly confirmTone: "normal";
        readonly inputPlaceholder: "feature/my-branch";
    } | null;
    handleConfirm: () => Promise<void>;
};
export {};
