interface CommitMessageDialogProps {
    readonly open: boolean;
    readonly fileCount: number;
    readonly onCancel: () => void;
    readonly onConfirm: (message: string) => void;
}
/**
 * Collects an explicit commit message for a commit-bearing stacked git action
 * (review B2): a one-click action must never invent an unreviewed "Update" commit.
 * Uses a native <dialog> for focus trapping, Escape handling, and a11y.
 */
export declare function CommitMessageDialog({ open, fileCount, onCancel, onConfirm, }: CommitMessageDialogProps): import("node_modules/@types/react").JSX.Element | null;
export {};
