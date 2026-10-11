import type { McpConfigFileScope, McpConfiguredServerView } from '@shared/types/mcp-configuration'
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
import { mcpMissingSecrets } from '../lib/mcp-server-model'

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
/** The vault secrets a server reads that the vault lacks; none until the vault's list arrives. */
export function useMcpMissingSecrets() {
  const vault = useMcpSecrets()
  return (server: McpConfiguredServerView) =>
    vault.loaded ? mcpMissingSecrets(server, vault.secrets) : []
}

interface SecretOperation {
  readonly kind: 'save' | 'remove'
  readonly name: string
  readonly run: () => ReturnType<typeof api.listMcpSecrets>
}

function pendingSecretOperation(operation: SecretOperation | undefined) {
  return operation ? { kind: operation.kind, name: operation.name } : null
}

export function useMcpSecrets() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const secrets = useQuery(mcpSecretsQueryOptions())
  const change = useMutation({
    mutationFn: (operation: SecretOperation) => operation.run(),
    onMutate: () => setError(null),
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: (next) => queryClient.setQueryData(mcpQueryKeys.secrets, next),
  })
  return {
    secrets: secrets.data ?? [],
    /** False until the list arrives, so nothing is called missing before it is known. */
    loaded: secrets.data !== undefined,
    loadError: secrets.error ? ipcErrorMessage(secrets.error) : null,
    error,
    pending: change.isPending,
    /** What is being changed, so a delete does not read as "Saving…". */
    pendingOperation: change.isPending ? pendingSecretOperation(change.variables) : null,
    save: async (name: string, value: string) => {
      try {
        await change.mutateAsync({
          kind: 'save',
          name,
          run: () => api.setMcpSecret({ name, value }),
        })
        return true
      } catch {
        return false
      }
    },
    remove: (name: string) =>
      change.mutate({ kind: 'remove', name, run: () => api.removeMcpSecret({ name }) }),
  }
}
