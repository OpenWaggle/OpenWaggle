import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpServerExposure,
  McpWriteDestination,
} from '@shared/types/mcp-configuration'
import type {
  McpAddServerRequest,
  McpSignInResultView,
} from '@shared/types/mcp-configuration-operations'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  mcpConfigurationQueryOptions,
  mcpQueryKeys,
  mcpServerStatusesQueryOptions,
} from '@/queries/mcp-configuration'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { mcpServerRow, sortMcpServersByAttention } from '../lib/mcp-server-model'

/**
 * Settings > MCP reads and changes Pi's MCP files through the Session Host. Opening it reads the
 * files and every server's known state; only "Check connection" connects to a server.
 */

/** The servers whose "Check connection" is running. */
function useCheckingServers(projectPath: string | null) {
  const names = useMutationState({
    filters: { mutationKey: mcpQueryKeys.checks(projectPath), status: 'pending' },
    select: (mutation) => mutation.state.variables,
  })
  return new Set(names.filter((name): name is string => typeof name === 'string'))
}

/** The merged configuration and what is known about each server's state. */
export function useMcpConfiguration(projectPath: string | null) {
  const configuration = useQuery(mcpConfigurationQueryOptions(projectPath))
  const statuses = useQuery(mcpServerStatusesQueryOptions(projectPath))
  const checking = useCheckingServers(projectPath)
  const known = new Map((statuses.data ?? []).map((status) => [status.name, status]))
  const rows = sortMcpServersByAttention(
    (configuration.data?.servers ?? []).map((server) =>
      mcpServerRow(server, known.get(server.name), checking.has(server.name)),
    ),
  )
  const failure = configuration.error ?? statuses.error
  return {
    view: configuration.data ?? null,
    rows,
    isLoading: configuration.isPending || statuses.isPending,
    loadError: failure ? ipcErrorMessage(failure) : null,
  }
}

interface ChangeVariables {
  readonly run: () => Promise<McpConfigurationView>
}

/** Configuration changes. Each answers with the files as they are afterwards. */
export function useMcpConfigurationActions(projectPath: string | null) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: (variables: ChangeVariables) => variables.run(),
    onMutate: () => setError(null),
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: async (view) => {
      queryClient.setQueryData(mcpQueryKeys.configuration(projectPath), view)
      await queryClient.invalidateQueries({ queryKey: mcpQueryKeys.statuses(projectPath) })
    },
  })
  // The one action that connects; the Host remembers the result as the server's last check.
  const check = useMutation({
    mutationKey: mcpQueryKeys.checks(projectPath),
    mutationFn: (name: string) => api.inspectMcpServer({ projectPath, name }),
    onMutate: () => setError(null),
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: mcpQueryKeys.statuses(projectPath) }),
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
      apply({ run: () => api.setMcpServerEnabled({ projectPath, name, enabled, target }) }),
    setExposure: (
      name: string,
      input: {
        readonly exposure?: McpServerExposure
        readonly toolExposure?: Readonly<Record<string, McpServerExposure | null>>
      },
    ) => apply({ run: () => api.setMcpServerExposure({ projectPath, name, ...input }) }),
    addServer: (request: Omit<McpAddServerRequest, 'projectPath'>) =>
      apply({ run: () => api.addMcpServer({ projectPath, ...request }) }),
    removeServer: (name: string) =>
      apply({ run: () => api.removeMcpServer({ projectPath, name }) }),
    /** Removes only the orphaned override the view reported in `fileId`. */
    removeOrphanedOverride: (name: string, fileId: McpWriteDestination) =>
      apply({
        run: () => api.removeMcpServer({ projectPath, name, orphanedOverride: { fileId } }),
      }),
    installCatalogServer: (catalogName: string, scope: McpConfigFileScope) =>
      apply({ run: () => api.installMcpCatalogServer({ projectPath, catalogName, scope }) }),
    /** "Check connection": connects to the server, lists its tools, and disconnects. */
    recheck: (name: string) => check.mutate(name),
  }
}

/** Host-owned OAuth sign-in and sign-out, shared with `openwaggle mcp login|logout`. */
export function useMcpSignIn(projectPath: string | null, name: string) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<McpSignInResultView | null>(null)
  const refreshState = () =>
    queryClient.invalidateQueries({ queryKey: mcpQueryKeys.statuses(projectPath) })
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
