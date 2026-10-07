import type { McpSecretSummary } from '@shared/types/mcp'
import type { McpConfigurationView, McpServerInspection } from '@shared/types/mcp-configuration'
import type { McpImportPreviewView } from '@shared/types/mcp-configuration-operations'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import type { OpenWaggleQueryOptions } from './query-options'

/** Settings > MCP data, read from the Session Host. */

const INSPECTION_STALE_MS = 60_000

export const mcpQueryKeys = {
  configuration: (projectPath: string | null) => ['mcpConfiguration', projectPath] as const,
  inspections: (projectPath: string | null, name?: string) =>
    name === undefined
      ? (['mcpServerInspection', projectPath] as const)
      : (['mcpServerInspection', projectPath, name] as const),
  inspection: (projectPath: string | null, name: string, target: string) =>
    ['mcpServerInspection', projectPath, name, target] as const,
  imports: (projectPath: string | null) => ['mcpImportPreview', projectPath] as const,
  secrets: ['mcpSecrets'] as const,
}

export function mcpConfigurationQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  McpConfigurationView,
  Error,
  McpConfigurationView,
  ReturnType<typeof mcpQueryKeys.configuration>
> {
  return queryOptions({
    queryKey: mcpQueryKeys.configuration(projectPath),
    queryFn: () => api.getMcpConfiguration({ projectPath }),
  })
}

/** Connecting can start a server, so a state stays fresh for a minute and failures are not retried. */
export function mcpServerInspectionQueryOptions(
  projectPath: string | null,
  server: { readonly name: string; readonly target: string },
): OpenWaggleQueryOptions<
  McpServerInspection,
  Error,
  McpServerInspection,
  ReturnType<typeof mcpQueryKeys.inspection>
> {
  return queryOptions({
    queryKey: mcpQueryKeys.inspection(projectPath, server.name, server.target),
    queryFn: () => api.inspectMcpServer({ projectPath, name: server.name }),
    staleTime: INSPECTION_STALE_MS,
    retry: false,
  })
}

export function mcpImportPreviewQueryOptions(
  projectPath: string | null,
  enabled: boolean,
): OpenWaggleQueryOptions<
  McpImportPreviewView,
  Error,
  McpImportPreviewView,
  ReturnType<typeof mcpQueryKeys.imports>
> {
  return queryOptions({
    queryKey: mcpQueryKeys.imports(projectPath),
    queryFn: () => api.previewMcpImports({ projectPath }),
    enabled,
  })
}

export function mcpSecretsQueryOptions(): OpenWaggleQueryOptions<
  readonly McpSecretSummary[],
  Error,
  readonly McpSecretSummary[],
  typeof mcpQueryKeys.secrets
> {
  return queryOptions({ queryKey: mcpQueryKeys.secrets, queryFn: () => api.listMcpSecrets() })
}
