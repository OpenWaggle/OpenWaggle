import type { SessionSummary } from '@shared/types/session';
export type SidebarSessionSortMode = 'recent' | 'oldest' | 'name';
export interface SidebarProjectGroup {
    readonly projectPath: string;
    readonly sessions: readonly SessionSummary[];
    readonly firstSessionCreatedAt: number;
    readonly latestUpdatedAt: number;
}
export interface SidebarProjectGroups {
    readonly projects: readonly SidebarProjectGroup[];
}
interface BuildSidebarProjectGroupsInput {
    readonly sessions: readonly SessionSummary[];
    readonly currentProjectPath: string | null;
    readonly recentProjects: readonly string[];
    readonly sortMode: SidebarSessionSortMode;
}
export declare function buildSidebarProjectGroups({ sessions, currentProjectPath, recentProjects, sortMode, }: BuildSidebarProjectGroupsInput): SidebarProjectGroups;
export {};
