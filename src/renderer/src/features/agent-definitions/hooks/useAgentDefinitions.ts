import type { AgentDefinitionDisplayItem } from '@shared/types/agent-definition'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  agentDefinitionPreviewQueryOptions,
  agentDefinitionsQueryOptions,
} from '@/queries/agent-definitions'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'

export function useAgentDefinitions(projectPath: string | null) {
  const queryClient = useQueryClient()
  const [explicitName, setExplicitName] = useState<string | null>(null)
  const listQuery = useQuery(agentDefinitionsQueryOptions(projectPath))
  const items: readonly AgentDefinitionDisplayItem[] = listQuery.data ?? []
  const selectedName = items.some((item) => item.name === explicitName)
    ? explicitName
    : (items[0]?.name ?? null)
  const previewQuery = useQuery(agentDefinitionPreviewQueryOptions(projectPath, selectedName))
  const toggleMutation = useMutation({
    mutationFn: (input: {
      readonly projectPath: string
      readonly name: string
      readonly enabled: boolean
    }) => api.setAgentDefinitionEnabled(input.projectPath, input.name, input.enabled),
    onSuccess: (_result, input) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentDefinitions(input.projectPath),
        exact: true,
      }),
  })

  return {
    items,
    selectedName,
    selectAgent: setExplicitName,
    previewMarkdown: previewQuery.data?.markdown ?? '',
    isLoading: listQuery.isPending,
    isPreviewLoading: previewQuery.isPending,
    error:
      listQuery.error ??
      previewQuery.error ??
      (toggleMutation.variables?.projectPath === projectPath ? toggleMutation.error : null),
    refresh: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.agentDefinitions(projectPath),
        exact: true,
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.agentDefinitionPreview(projectPath, selectedName),
        exact: true,
      })
    },
    toggleAgent: (name: string, enabled: boolean) => {
      if (!projectPath) return
      toggleMutation.mutate({ projectPath, name, enabled })
    },
  }
}
