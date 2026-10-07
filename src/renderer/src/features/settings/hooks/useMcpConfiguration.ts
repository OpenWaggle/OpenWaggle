import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpServerExposure,
  McpServerInspection,
} from '@shared/types/mcp-configuration'
import type {
  McpAddServerRequest,
  McpSignInResultView,
} from '@shared/types/mcp-configuration-operations'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  mcpConfigurationQueryOptions,
  mcpQueryKeys,
  mcpServerInspectionQueryOptions,
} from '@/queries/mcp-configuration'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import {
  type McpServerRow,
  mcpServerStatus,
  sortMcpServersByAttention,
} from '../lib/mcp-server-model'

/** Settings > MCP reads and changes Pi's MCP files through the Session Host. */

function failedInspection(name: string, error: unknown): McpServerInspection {
  return { name, state: 'failed', tools: [], error: ipcErrorMessage(error) }
}

/** The merged configuration and, for every enabled server, its live state. */
export function useMcpConfiguration(projectPath: string | null) {
  const configuration = useQuery(mcpConfigurationQueryOptions(projectPath))
  const servers = configuration.data?.servers ?? []
  const enabled = servers.filter((server) => server.enabled)
  const inspections = useQueries({
    queries: enabled.map((server) => mcpServerInspectionQueryOptions(projectPath, server)),
  })
  const byName = new Map<string, McpServerInspection>()
  enabled.forEach((server, index) => {
    const query = inspections[index]
    if (query?.data) {
      byName.set(server.name, query.data)
      return
    }
    if (query?.error) byName.set(server.name, failedInspection(server.name, query.error))
  })
  const rows: McpServerRow[] = sortMcpServersByAttention(
    servers.map((server) => {
      const inspection = byName.get(server.name)
      return {
        server,
        status: mcpServerStatus(server, inspection),
        ...(inspection ? { inspection } : {}),
      }
    }),
  )
  return {
    view: configuration.data ?? null,
    rows,
    isLoading: configuration.isPending,
    loadError: configuration.error ? ipcErrorMessage(configuration.error) : null,
  }
}

interface ChangeVariables {
  readonly run: () => Promise<McpConfigurationView>
  /** The server whose live state the change affects. */
  readonly server?: string
}

/** Configuration changes. Each answers with the files as they are afterwards. */
export function useMcpConfigurationActions(projectPath: string | null) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: (variables: ChangeVariables) => variables.run(),
    onMutate: () => setError(null),
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: async (view, variables) => {
      queryClient.setQueryData(mcpQueryKeys.configuration(projectPath), view)
      await queryClient.invalidateQueries({
        queryKey: mcpQueryKeys.inspections(projectPath, variables.server),
      })
    },
  })
  const apply = async (variables: ChangeVariables) => {
    try {
      await change.mutateAsync(variables)
      return true
    } catch {
      return false
    }
  }

  return {
    error,
    clearError: () => setError(null),
    pending: change.isPending,
    setEnabled: (name: string, enabled: boolean, target: 'server' | 'project' = 'server') =>
      apply({
        server: name,
        run: () => api.setMcpServerEnabled({ projectPath, name, enabled, target }),
      }),
    setExposure: (
      name: string,
      input: {
        readonly exposure?: McpServerExposure
        readonly toolExposure?: Readonly<Record<string, McpServerExposure | null>>
      },
    ) =>
      apply({ server: name, run: () => api.setMcpServerExposure({ projectPath, name, ...input }) }),
    addServer: (request: Omit<McpAddServerRequest, 'projectPath'>) =>
      apply({ server: request.name, run: () => api.addMcpServer({ projectPath, ...request }) }),
    removeServer: (name: string) =>
      apply({ server: name, run: () => api.removeMcpServer({ projectPath, name }) }),
    installCatalogServer: (catalogName: string, scope: McpConfigFileScope) =>
      apply({
        server: catalogName,
        run: () => api.installMcpCatalogServer({ projectPath, catalogName, scope }),
      }),
    recheck: (name: string) =>
      queryClient.invalidateQueries({ queryKey: mcpQueryKeys.inspections(projectPath, name) }),
  }
}

/** Host-owned OAuth sign-in and sign-out, shared with `openwaggle mcp login|logout`. */
export function useMcpSignIn(projectPath: string | null, name: string) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<McpSignInResultView | null>(null)
  const refreshState = () =>
    queryClient.invalidateQueries({ queryKey: mcpQueryKeys.inspections(projectPath, name) })
  const signIn = useMutation({
    mutationFn: () => api.signInMcpServer({ projectPath, name }),
    onMutate: () => {
      setError(null)
      setResult(null)
    },
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: async (next) => {
      setResult(next)
      await refreshState()
    },
  })
  const signOut = useMutation({
    mutationFn: () => api.signOutMcpServer({ projectPath, name }),
    onMutate: () => {
      setError(null)
      setResult(null)
    },
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: refreshState,
  })
  return {
    error,
    result,
    pending: signIn.isPending || signOut.isPending,
    signIn: () => signIn.mutate(),
    signOut: () => signOut.mutate(),
  }
}
