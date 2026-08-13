import type { GitCommitResult, GitStatusSummary } from '@shared/types/git';
interface CommitDialogProps {
    projectPath: string | null;
    status: GitStatusSummary | null;
    statusError: string | null;
    isRefreshing: boolean;
    isCommitting: boolean;
    onRefresh: () => void;
    onCommit: (message: string, amend: boolean, paths: string[]) => Promise<GitCommitResult>;
    onClose: () => void;
}
export declare function CommitDialog({ projectPath, status, statusError, isRefreshing, isCommitting, onRefresh, onCommit, onClose, }: CommitDialogProps): import("node_modules/@types/react").JSX.Element;
export {};
