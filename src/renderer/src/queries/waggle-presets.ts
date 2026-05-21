import type { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type WagglePresets = Awaited<ReturnType<typeof api.listWagglePresets>>

export function wagglePresetsQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  WagglePresets,
  Error,
  WagglePresets,
  ReturnType<typeof queryKeys.wagglePresets>
> {
  return queryOptions({
    queryKey: queryKeys.wagglePresets(projectPath),
    queryFn: () => api.listWagglePresets(projectPath),
  })
}

export function useSaveWagglePresetMutation(projectPath: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (preset: WagglePreset) => api.saveWagglePreset(preset, projectPath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.wagglePresets(projectPath),
        exact: true,
      })
    },
  })
}

export function useDeleteWagglePresetMutation(projectPath: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (presetId: WagglePresetId) => api.deleteWagglePreset(presetId, projectPath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.wagglePresets(projectPath),
        exact: true,
      })
    },
  })
}
