import type { SessionBranchId, SessionId } from '@shared/types/brand';
import { api } from '@/shared/lib/ipc';
import { queryKeys } from './query-keys';
import type { OpenWaggleQueryOptions } from './query-options';
type ArchivedSessions = Awaited<ReturnType<typeof api.listArchivedSessions>>;
type ArchivedSessionBranches = Awaited<ReturnType<typeof api.listArchivedSessionBranches>>;
export declare function archivedSessionsQueryOptions(): OpenWaggleQueryOptions<ArchivedSessions, Error, ArchivedSessions, typeof queryKeys.archivedSessions>;
export declare function archivedSessionBranchesQueryOptions(): OpenWaggleQueryOptions<ArchivedSessionBranches, Error, ArchivedSessionBranches, typeof queryKeys.archivedSessionBranches>;
interface RestoreSessionBranchInput {
    readonly sessionId: SessionId;
    readonly branchId: SessionBranchId;
}
export declare function useUnarchiveSessionMutation(): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<void, Error, SessionId, unknown>;
export declare function useRestoreSessionBranchMutation(): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<void, Error, RestoreSessionBranchInput, unknown>;
export declare function useArchivedDeleteSessionMutation(): import("node_modules/@tanstack/react-query/build/modern").UseMutationResult<void, Error, SessionId, unknown>;
export {};
