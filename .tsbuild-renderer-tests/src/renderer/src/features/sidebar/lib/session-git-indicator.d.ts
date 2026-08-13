import type { GitStatusSummary } from '@shared/types/git';
/** What a session's row shows about its working tree at a glance. */
export interface SessionGitIndicator {
    /** Uncommitted changes exist in this session's working tree. */
    readonly isDirty: boolean;
    readonly changedFileCount: number;
    readonly ahead: number;
    readonly behind: number;
    /** Short text for the row, empty when there is nothing worth showing. */
    readonly label: string;
    /** Full description for assistive technology and the row tooltip. */
    readonly description: string;
}
/**
 * Summarise one session's working tree for its row in a session list.
 *
 * Deliberately returns an empty indicator rather than a placeholder when status is
 * unknown: a session whose status has not been fetched must not look clean, because
 * "no badge" and "confirmed clean" would otherwise be indistinguishable.
 */
export declare function buildSessionGitIndicator(status: GitStatusSummary | null | undefined): SessionGitIndicator;
