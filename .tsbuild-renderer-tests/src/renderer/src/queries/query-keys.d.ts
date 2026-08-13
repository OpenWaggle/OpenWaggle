import type { SessionId } from '@shared/types/brand';
export declare function extensionPackagesQueryKey(projectPath: string | null): readonly ["extensionPackages", string | null];
export declare const queryKeys: {
    wagglePresets: (projectPath: string | null) => readonly ["wagglePresets", string | null];
    archivedSessions: readonly ["archivedSessions"];
    archivedSessionBranches: readonly ["archivedSessionBranches"];
    extensionPackages: typeof extensionPackagesQueryKey;
    sessions: readonly ["sessions"];
    session: (id: SessionId | null) => readonly ["session", SessionId | null];
    skills: (projectPath: string | null) => readonly ["skills", string | null];
    skillPreview: (projectPath: string | null, skillId: string | null) => readonly ["skillPreview", string | null, string | null];
};
