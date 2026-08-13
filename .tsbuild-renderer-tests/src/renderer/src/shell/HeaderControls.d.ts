import type { GitStatusSummary } from '@shared/types/git';
interface HeaderLeftProps {
    readonly activeBranchName: string;
    readonly projectPath: string | null;
    readonly sidebarOpen: boolean;
    readonly title: string;
    readonly onToggleSidebar: () => void;
}
interface TerminalButtonProps {
    readonly open: boolean;
    readonly projectPath: string | null;
    readonly onToggle: () => void;
}
interface CommitButtonProps {
    readonly isCommitting: boolean;
    readonly projectPath: string | null;
    readonly onOpen: () => void;
}
interface SessionTreeButtonProps {
    readonly hasSessionTree: boolean;
    readonly isChatRoute: boolean;
    readonly open: boolean;
    readonly onToggle: () => void;
}
interface DiffToggleButtonProps {
    readonly error: string | null;
    readonly isChatRoute: boolean;
    readonly isLoading: boolean;
    readonly open: boolean;
    readonly projectPath: string | null;
    readonly status: GitStatusSummary | null;
    readonly onToggle: () => void;
}
export declare function HeaderLeft({ activeBranchName, projectPath, sidebarOpen, title, onToggleSidebar, }: HeaderLeftProps): import("node_modules/@types/react").JSX.Element;
export declare function TerminalButton({ open, projectPath, onToggle }: TerminalButtonProps): import("node_modules/@types/react").JSX.Element;
export declare function CommitButton({ isCommitting, projectPath, onOpen }: CommitButtonProps): import("node_modules/@types/react").JSX.Element;
export declare function SessionTreeButton({ hasSessionTree, isChatRoute, open, onToggle, }: SessionTreeButtonProps): import("node_modules/@types/react").JSX.Element;
export declare function DiffToggleButton({ error, isChatRoute, isLoading, open, projectPath, status, onToggle, }: DiffToggleButtonProps): import("node_modules/@types/react").JSX.Element;
export {};
