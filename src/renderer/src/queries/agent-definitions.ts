import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

function fetchAgentDefinitions(projectPath: string) {
  return api.listAgentDefinitionDisplay(projectPath)
}

function fetchAgentDefinitionPreview(projectPath: string, name: string) {
  return api.getAgentDefinitionPreview(projectPath, name)
}

export function agentDefinitionsQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  Awaited<ReturnType<typeof fetchAgentDefinitions>>,
  Error,
  Awaited<ReturnType<typeof fetchAgentDefinitions>>,
  ReturnType<typeof queryKeys.agentDefinitions>
> {
  return queryOptions({
    queryKey: queryKeys.agentDefinitions(projectPath),
    enabled: projectPath !== null,
    queryFn: () => {
      if (!projectPath) throw new Error('Select a project to load agents.')
      return fetchAgentDefinitions(projectPath)
    },
  })
}

export function agentDefinitionPreviewQueryOptions(
  projectPath: string | null,
  name: string | null,
): OpenWaggleQueryOptions<
  Awaited<ReturnType<typeof fetchAgentDefinitionPreview>>,
  Error,
  Awaited<ReturnType<typeof fetchAgentDefinitionPreview>>,
  ReturnType<typeof queryKeys.agentDefinitionPreview>
> {
  return queryOptions({
    queryKey: queryKeys.agentDefinitionPreview(projectPath, name),
    enabled: projectPath !== null && name !== null,
    queryFn: () => {
      if (!projectPath || !name) throw new Error('Select an agent to preview it.')
      return fetchAgentDefinitionPreview(projectPath, name)
    },
  })
}
