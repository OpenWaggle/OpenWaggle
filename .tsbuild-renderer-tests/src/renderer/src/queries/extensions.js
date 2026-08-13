import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/ipc';
import { rendererQueryClient } from './query-client';
const extensionApi = api;
const EXTENSION_CONTRIBUTIONS_QUERY_KEY = 'extensionContributions';
function extensionPackagesQueryKey(projectPaths) {
    return ['extensionPackages', ...projectPaths];
}
function extensionContributionsKey(projectPaths, sessionId) {
    return [
        EXTENSION_CONTRIBUTIONS_QUERY_KEY,
        ...projectPaths,
        ...(sessionId !== undefined ? [`session:${sessionId}`] : []),
    ];
}
function listExtensionPackages(input) {
    return extensionApi.listExtensionPackages(input);
}
function listExtensionContributions(input) {
    return extensionApi.listExtensionContributions(input);
}
function extensionContributionsInput(input) {
    return {
        projectPaths: input.projectPaths,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    };
}
function setExtensionTrusted(input) {
    return extensionApi.setExtensionTrusted(input);
}
function setExtensionEnabled(input) {
    return extensionApi.setExtensionEnabled(input);
}
function setExtensionProjectDisabled(input) {
    return extensionApi.setExtensionProjectDisabled(input);
}
function acceptExtensionUpdate(input) {
    return extensionApi.acceptExtensionUpdate(input);
}
function approveExtensionBuild(input) {
    return extensionApi.approveExtensionBuild(input);
}
function reloadExtension(input) {
    return extensionApi.reloadExtension(input);
}
function applyExtensionPackageRemove(input) {
    return extensionApi.applyExtensionPackageRemove(input);
}
function syncExtensionQueriesAfterMutation(input) {
    input.queryClient.setQueryData(extensionPackagesQueryKey(input.projectPaths), input.view);
    return invalidateExtensionContributionsQueries(input.queryClient);
}
export function invalidateExtensionContributionsQueries(queryClient = rendererQueryClient) {
    return queryClient.invalidateQueries({
        queryKey: [EXTENSION_CONTRIBUTIONS_QUERY_KEY],
    });
}
export function extensionPackagesQueryOptions(projectPaths) {
    const queryKey = extensionPackagesQueryKey(projectPaths);
    return queryOptions({
        queryKey,
        queryFn: () => listExtensionPackages({ projectPaths }),
    });
}
export function extensionContributionsQueryOptions(projectPaths, options = {}) {
    const sessionId = options.sessionId ?? undefined;
    const queryKey = extensionContributionsKey(projectPaths, sessionId);
    return queryOptions({
        queryKey,
        queryFn: () => listExtensionContributions(extensionContributionsInput({ projectPaths, sessionId })),
    });
}
export function useSetExtensionTrustedMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: setExtensionTrusted,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useSetExtensionEnabledMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: setExtensionEnabled,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useSetExtensionProjectDisabledMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: setExtensionProjectDisabled,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useAcceptExtensionUpdateMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: acceptExtensionUpdate,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useApproveExtensionBuildMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: approveExtensionBuild,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useReloadExtensionMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: reloadExtension,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
export function useApplyExtensionPackageRemoveMutation(projectPaths) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: applyExtensionPackageRemove,
        onSuccess: (view) => {
            return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view });
        },
    });
}
