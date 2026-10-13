import type { McpConfiguredServerView, McpServerInspection } from '@shared/types/mcp-configuration'
import type { McpManagementCommandInput } from './mcp-cli-management-context'

/**
 * Checks every enabled server, in parallel. A check that fails outright (a value that cannot be
 * resolved, a Host error) becomes that server's failed state, so one server never hides the rest.
 */
export async function inspectEnabledServers(
  context: McpManagementCommandInput['context'],
  projectPath: string | null,
  servers: readonly McpConfiguredServerView[],
): Promise<ReadonlyMap<string, McpServerInspection>> {
  const enabled = servers.filter((server) => server.enabled)
  const settled = await Promise.allSettled(
    enabled.map((server) =>
      Promise.resolve().then(() =>
        context.host.invoke('mcp:inspect-server', { projectPath, name: server.name }),
      ),
    ),
  )
  return new Map(
    enabled.map((server, index): [string, McpServerInspection] => {
      const outcome = settled[index]
      if (outcome?.status === 'fulfilled') return [server.name, outcome.value]
      const reason: unknown = outcome?.reason
      return [
        server.name,
        {
          name: server.name,
          state: 'failed',
          tools: [],
          error: reason instanceof Error ? reason.message : String(reason),
        },
      ]
    }),
  )
}
