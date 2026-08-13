import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/ipc';
import { queryKeys } from './query-keys';
export function wagglePresetsQueryOptions(projectPath) {
    return queryOptions({
        queryKey: queryKeys.wagglePresets(projectPath),
        queryFn: () => api.listWagglePresets(projectPath),
    });
}
export function useSaveWagglePresetMutation(projectPath) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (preset) => api.saveWagglePreset(preset, projectPath),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.wagglePresets(projectPath),
                exact: true,
            });
        },
    });
}
export function useDeleteWagglePresetMutation(projectPath) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (presetId) => api.deleteWagglePreset(presetId, projectPath),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.wagglePresets(projectPath),
                exact: true,
            });
        },
    });
}
