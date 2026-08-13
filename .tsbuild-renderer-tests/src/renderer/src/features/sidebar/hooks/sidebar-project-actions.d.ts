import type { SessionSummary } from '@shared/types/session';
import type { useNavigate } from '@tanstack/react-router';
type Navigate = ReturnType<typeof useNavigate>;
interface SidebarProjectActionDeps {
    readonly activeSessionId: string | null;
    readonly displayProjectName: (path: string) => string;
    readonly expandProject: (path: string) => void;
    readonly loadChatSessions: () => Promise<void>;
    readonly loadSessionTrees: () => Promise<void>;
    readonly navigate: Navigate;
    readonly projectPath: string | null;
    readonly refreshGit: (path: string | null) => void;
    readonly removeProjectReferences: (path: string) => Promise<void>;
    readonly selectFolder: () => Promise<string | null>;
    readonly sessions: readonly SessionSummary[];
    readonly setProjectDisplayName: (path: string, name: string) => Promise<void>;
    readonly setProjectPath: (path: string) => Promise<void>;
    readonly showToast: (message: string) => void;
    readonly startDraftSession: (projectPath: string | null) => void;
    readonly clearTransientDraftContext: () => void;
}
export declare function createSidebarProjectActions(deps: SidebarProjectActionDeps): {
    archiveSessions(path: string, projectSessions: readonly SessionSummary[]): void;
    openProject(): Promise<void>;
    openInFinder(path: string): void;
    remove(path: string): void;
    rename(path: string, name: string): void;
    selectProjectPath(path: string): Promise<void>;
};
export {};
