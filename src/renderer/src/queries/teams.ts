import type { TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

export function teamPresetsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.teams,
    queryFn: () => api.listTeams(),
  })
}

export function useSaveTeamPresetMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (preset: WaggleTeamPreset) => api.saveTeam(preset),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams, exact: true })
    },
  })
}

export function useDeleteTeamPresetMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (presetId: TeamConfigId) => api.deleteTeam(presetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams, exact: true })
    },
  })
}
