import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'

/** Settings > MCP data, read from the Session Host. */

export const mcpQueryKeys = {
  configuration: (projectPath: string | null) => ['mcpConfiguration', projectPath] as const,
  statuses: (projectPath: string | null) => ['mcpServerStatuses', projectPath] as const,
  /** Every project's server states, which a change to the vault's secrets affects. */
  allStatuses: ['mcpServerStatuses'] as const,
  /** The mutation key of "Check connection", the only action that connects to a server. */
  checks: (projectPath: string | null) => ['mcpServerCheck', projectPath] as const,
  imports: (projectPath: string | null) => ['mcpImportPreview', projectPath] as const,
  secrets: ['mcpSecrets'] as const,
  sessionEnabled: (sessionId: string) => ['sessionMcpEnabled', sessionId] as const,
}

export function mcpConfigurationQueryOptions(projectPath: string | null) {
  return queryOptions({
    queryKey: mcpQueryKeys.configuration(projectPath),
    queryFn: () => api.getMcpConfiguration({ projectPath }),
  })
}

/**
 * Every server's state without connecting: a warm connection's, the last check's, or none yet.
 * Reading it starts no server, so it is safe on every open of Settings > MCP.
 */
export function mcpServerStatusesQueryOptions(projectPath: string | null) {
  return queryOptions({
    queryKey: mcpQueryKeys.statuses(projectPath),
    queryFn: () => api.getMcpServerStatuses({ projectPath }),
  })
}

export function mcpImportPreviewQueryOptions(projectPath: string | null, enabled: boolean) {
  return queryOptions({
    queryKey: mcpQueryKeys.imports(projectPath),
    queryFn: () => api.previewMcpImports({ projectPath }),
    enabled,
  })
}

export function mcpSecretsQueryOptions() {
  return queryOptions({ queryKey: mcpQueryKeys.secrets, queryFn: () => api.listMcpSecrets() })
}

/** Whether a Session's Runs use MCP servers: on until the Session is switched off. */
export function sessionMcpEnabledQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: mcpQueryKeys.sessionEnabled(sessionId),
    queryFn: () => api.getSessionMcpEnabled({ sessionId }),
  })
}
