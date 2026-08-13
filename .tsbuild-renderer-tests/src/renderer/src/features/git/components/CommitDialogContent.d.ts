import type { GitStatusSummary } from '@shared/types/git';
interface CommitDialogBodyProps {
    readonly status: GitStatusSummary | null;
    readonly statusError: string | null;
    readonly error: string | null;
    readonly isRefreshing: boolean;
    readonly form: {
        readonly message: string;
        readonly amend: boolean;
        readonly selectedPaths: ReadonlySet<string>;
    };
    readonly actions: {
        readonly onRefresh: () => void;
        readonly onMessageChange: (message: string) => void;
        readonly onAmendChange: (amend: boolean) => void;
        readonly onTogglePath: (filePath: string) => void;
        readonly onToggleAll: () => void;
    };
}
export declare function CommitDialogBody({ status, statusError, error, isRefreshing, form, actions, }: CommitDialogBodyProps): import("node_modules/@types/react").JSX.Element;
interface CommitDialogFooterProps {
    readonly canSubmit: boolean;
    readonly isCommitting: boolean;
    readonly onClose: () => void;
    readonly onCommit: () => void;
}
export declare function CommitDialogFooter({ canSubmit, isCommitting, onClose, onCommit, }: CommitDialogFooterProps): import("node_modules/@types/react").JSX.Element;
export {};
