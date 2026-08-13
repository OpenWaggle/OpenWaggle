import type { LocalVcsStatus, RemoteVcsStatus, VcsStatus } from '@shared/types/git';
/**
 * Loads the combined VCS status for a project: Local status resolves instantly,
 * Remote status loads asynchronously and is merged in when it arrives. Returns
 * null until the local half is available.
 */
export declare function useCombinedVcsStatus(projectPath: string | null): {
    status: VcsStatus | null;
    local: LocalVcsStatus | null;
    remote: RemoteVcsStatus | null;
    refresh: () => Promise<void>;
};
