import type { SessionSummary } from '@shared/types/session';
export interface ProjectGroup {
    path: string | null;
    displayName: string;
    sessions: SessionSummary[];
}
export declare function groupSessionsByProject(sessions: SessionSummary[], displayNameOverrides?: Record<string, string>): ProjectGroup[];
