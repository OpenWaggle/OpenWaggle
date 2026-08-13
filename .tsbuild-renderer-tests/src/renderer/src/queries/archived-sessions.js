import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/ipc';
import { queryKeys } from './query-keys';
export function archivedSessionsQueryOptions() {
    return queryOptions({
        queryKey: queryKeys.archivedSessions,
        queryFn: () => api.listArchivedSessions(),
    });
}
export function archivedSessionBranchesQueryOptions() {
    return queryOptions({
        queryKey: queryKeys.archivedSessionBranches,
        queryFn: () => api.listArchivedSessionBranches(),
    });
}
export function useUnarchiveSessionMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (sessionId) => api.unarchiveSession(sessionId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.archivedSessions,
                exact: true,
            });
        },
    });
}
export function useRestoreSessionBranchMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ sessionId, branchId }) => api.restoreSessionBranch(sessionId, branchId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.archivedSessionBranches,
                exact: true,
            });
        },
    });
}
export function useArchivedDeleteSessionMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (sessionId) => api.deleteSession(sessionId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.archivedSessions,
                exact: true,
            });
        },
    });
}
