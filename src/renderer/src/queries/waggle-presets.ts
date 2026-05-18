import type { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import {
  queryOptions,
  type UseQueryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

type WagglePresetsQueryOptions = UseQueryOptions<
  Awaited<ReturnType<typeof api.listWagglePresets>>,
  Error,
  Awaited<ReturnType<typeof api.listWagglePresets>>,
  ReturnType<typeof queryKeys.wagglePresets>
>

export function wagglePresetsQueryOptions(projectPath: string | null): WagglePresetsQueryOptions {
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
