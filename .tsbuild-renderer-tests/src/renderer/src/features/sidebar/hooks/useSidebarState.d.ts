import { SessionId } from '@shared/types/brand';
import { type SidebarSessionSortMode } from '../lib/sidebar-project-groups';
export declare function useSidebarState(): {
    activeBranchId: import("@shared/types/brand").SessionBranchId | null | undefined;
    activeSessionId: SessionId | null;
    activeView: import("../model").SidebarView;
    chat: import("../../chat/hooks/useChat").ChatReturn;
    collapsedProjectPaths: ReadonlySet<string>;
    displayProjectName: (path: string) => string;
    git: {
        workingPath: string | null;
        repositoryPath: string | null;
        status: import("../../../../../shared/types/git").GitStatusSummary | null;
        isLoading: boolean;
        error: string | null;
        branches: import("../../../../../shared/types/git").GitBranchListResult | null;
        isCommitting: boolean;
        isBranchActionRunning: boolean;
        refreshStatus: (workingPath: string | null) => Promise<void>;
        refreshBranches: (repositoryPath: string | null) => Promise<void>;
        commit: (workingPath: string, payload: import("../../../../../shared/types/git").GitCommitPayload) => Promise<import("../../../../../shared/types/git").GitCommitResult>;
        checkoutBranch: (workingPath: string, payload: import("../../../../../shared/types/git").GitBranchCheckoutPayload) => Promise<import("../../../../../shared/types/git").GitBranchMutationResult>;
        createBranch: (workingPath: string, payload: import("../../../../../shared/types/git").GitBranchCreatePayload) => Promise<import("../../../../../shared/types/git").GitBranchMutationResult>;
    };
    isFullscreen: boolean;
    matchingActiveSessionTree: import("../../../../../shared/types/session").SessionTree | null;
    matchingActiveWorkspace: import("../../../../../shared/types/session").SessionWorkspace | null;
    navigate: import("@tanstack/router-core").UseNavigateResult<string>;
    preferences: {
        removeProjectReferences: (path: string) => Promise<void>;
        selectedModel: import("@shared/types/brand").SupportedModelId;
        setProjectDisplayName: (path: string, name: string) => Promise<void>;
    };
    project: {
        projectPath: string | null;
        selectFolder: () => Promise<string | null>;
        setProjectPath: (path: string | null) => Promise<void>;
    };
    sessionGroups: import("../lib/sidebar-project-groups").SidebarProjectGroups;
    sessions: import("../../sessions/hooks/useSessions").SessionsReturn;
    setCollapsedProjectPaths: import("node_modules/@types/react").Dispatch<import("node_modules/@types/react").SetStateAction<ReadonlySet<string>>>;
    setSortMenuOpen: import("node_modules/@types/react").Dispatch<import("node_modules/@types/react").SetStateAction<boolean>>;
    setSortMode: import("node_modules/@types/react").Dispatch<import("node_modules/@types/react").SetStateAction<SidebarSessionSortMode>>;
    showToast: (message: string, variant?: import("@/shell/ui-store").ToastData["variant"]) => void;
    sidebarOpen: boolean;
    sortMenuOpen: boolean;
    sortMode: SidebarSessionSortMode;
};
