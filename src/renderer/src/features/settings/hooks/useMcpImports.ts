import type { McpConfigFileScope } from '@shared/types/mcp-configuration'
import type {
  McpImportApplyResultView,
  McpImportNameConflictPolicy,
} from '@shared/types/mcp-configuration-operations'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  mcpImportPreviewQueryOptions,
  mcpQueryKeys,
  mcpSecretsQueryOptions,
} from '@/queries/mcp-configuration'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'

/** Servers found in other tools' files; read only while the import panel is open. */
export function useMcpImports(projectPath: string | null, open: boolean) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<McpImportApplyResultView | null>(null)
  const preview = useQuery(mcpImportPreviewQueryOptions(projectPath, open))
  const apply = useMutation({
    mutationFn: (input: {
      readonly fingerprints: readonly string[]
      readonly target: McpConfigFileScope
      readonly conflictPolicy: McpImportNameConflictPolicy
    }) => api.applyMcpImports({ projectPath, ...input }),
    onMutate: () => {
      setError(null)
      setResult(null)
    },
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: async (next) => {
      setResult(next)
      queryClient.setQueryData(mcpQueryKeys.configuration(projectPath), next.view)
      await queryClient.invalidateQueries({ queryKey: mcpQueryKeys.imports(projectPath) })
    },
  })
  return {
    preview: preview.data ?? null,
    isLoading: preview.isFetching,
    loadError: preview.error ? ipcErrorMessage(preview.error) : null,
    error,
    result,
    pending: apply.isPending,
    apply: apply.mutate,
  }
}

/** The encrypted vault behind `{ "secret": "<name>" }` values in OpenWaggle's MCP files. */
export function useMcpSecrets() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const secrets = useQuery(mcpSecretsQueryOptions())
  const change = useMutation({
    mutationFn: (run: () => ReturnType<typeof api.listMcpSecrets>) => run(),
    onMutate: () => setError(null),
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: (next) => queryClient.setQueryData(mcpQueryKeys.secrets, next),
  })
  return {
    secrets: secrets.data ?? [],
    loadError: secrets.error ? ipcErrorMessage(secrets.error) : null,
    error,
    pending: change.isPending,
    save: async (name: string, value: string) => {
      try {
        await change.mutateAsync(() => api.setMcpSecret({ name, value }))
        return true
      } catch {
        return false
      }
    },
    remove: (name: string) => change.mutate(() => api.removeMcpSecret({ name })),
  }
}
