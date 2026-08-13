import type { SessionSummary } from '@shared/types/session';
export interface ArchivedBranchProjectGroup {
    readonly path: string | null;
    readonly sessions: readonly SessionSummary[];
}
export declare function groupArchivedBranchesByProject(sessions: readonly SessionSummary[]): ArchivedBranchProjectGroup[];
