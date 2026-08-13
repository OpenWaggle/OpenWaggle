import type { SessionId } from '@shared/types/brand';
interface SessionNavItem {
    readonly id: SessionId;
    readonly projectPath: string | null;
}
interface SessionNavDeps {
    readonly sessions: readonly SessionNavItem[];
    readonly projectPath: string | null;
    readonly setActiveView: (view: 'chat' | 'skills') => void;
    readonly setProjectPath: (path: string | null) => Promise<void>;
    readonly selectFolder: () => Promise<string | null>;
    readonly startDraftSession: (projectPath?: string | null) => void;
    readonly setActiveSession: (id: SessionId | null) => void;
    readonly refreshGitStatus: (projectPath: string | null) => Promise<void>;
    readonly refreshGitBranches: (projectPath: string | null) => Promise<void>;
}
interface SessionNavHandlers {
    readonly handleSelectSession: (id: SessionId) => Promise<void>;
    readonly handleNewSession: () => void;
    readonly handleOpenProject: () => Promise<void>;
    readonly handleSelectProjectPath: (path: string) => Promise<void>;
}
/** Pure factory — testable without React. */
export declare function createSessionNavHandlers(deps: SessionNavDeps): SessionNavHandlers;
/** Hook wrapper — calls the factory with current deps. */
export declare function useSessionNav(deps: SessionNavDeps): SessionNavHandlers;
export {};
