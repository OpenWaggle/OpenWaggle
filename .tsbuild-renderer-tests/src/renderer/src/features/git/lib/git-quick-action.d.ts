import type { GitStackedAction, VcsStatus } from '@shared/types/git';
export interface GitQuickAction {
    readonly label: string;
    readonly disabled: boolean;
    readonly kind: 'run_action' | 'run_pull' | 'open_pr' | 'open_publish' | 'show_hint';
    readonly action?: GitStackedAction;
    readonly hint?: string;
}
/**
 * Compute the single next-best git action from combined VCS status.
 *
 * One button, one obvious next step, rather than exposing every git verb at once:
 * publish when there is no remote, open the change request when one exists, pull
 * when behind, otherwise commit. `isDefaultRef` and `hasPrimaryRemote` are read
 * from status so the decision needs no extra git calls.
 */
export declare function resolveQuickAction(status: VcsStatus | null, isBusy: boolean): GitQuickAction;
