import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mcpQueryKeys, sessionMcpEnabledQueryOptions } from '@/queries/mcp-configuration'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { useUIStore } from '@/shell/ui-store'

/**
 * A Session's MCP switch (ADR 0048). Every Session uses the configured MCP servers until it is
 * switched off; its next Run reads the switch, and switching off closes its servers.
 */
export function useSessionMcpSwitch(sessionId: string) {
  const queryClient = useQueryClient()
  const state = useQuery(sessionMcpEnabledQueryOptions(sessionId))
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.setSessionMcpEnabled({ sessionId, enabled }),
    onSuccess: (enabled) =>
      queryClient.setQueryData(mcpQueryKeys.sessionEnabled(sessionId), enabled),
    onError: (failure) =>
      useUIStore
        .getState()
        .showToast(`Could not change MCP for this Session: ${ipcErrorMessage(failure)}`, 'error'),
  })
  return {
    // On until the Host says otherwise, as every Session starts.
    enabled: state.data ?? true,
    pending: state.isPending || change.isPending,
    setEnabled: (enabled: boolean) => change.mutate(enabled),
  }
}
