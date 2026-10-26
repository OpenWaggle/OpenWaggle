import type { McpMergedConfig, McpMergedServer } from '../../../domain/mcp/config/mcp-config-merge'
import { env, readEnvironmentVariables } from '../../../env'

/** Why a Run, a status check, or a connection under hidden QA lacks the project's MCP servers. */
export const AUTOMATION_PROJECT_MCP_NOTICE =
  'Hidden QA automation (OPENWAGGLE_AUTOMATION=1) does not start servers that project MCP files define. Set OPENWAGGLE_AUTOMATION_PROJECT_MCP=1 to start them.'

export interface McpAutomationEnvironment {
  readonly OPENWAGGLE_AUTOMATION?: string
  readonly OPENWAGGLE_AUTOMATION_PROJECT_MCP?: string
}

function currentEnvironment(): McpAutomationEnvironment {
  return {
    ...readEnvironmentVariables(['OPENWAGGLE_AUTOMATION_PROJECT_MCP']),
    ...(env.OPENWAGGLE_AUTOMATION ? { OPENWAGGLE_AUTOMATION: env.OPENWAGGLE_AUTOMATION } : {}),
  }
}

/**
 * Whether servers defined by the project's MCP files (`.mcp.json`, `.pi/mcp.json`,
 * `.openwaggle/mcp.json`) may connect. Hidden QA starts the app on the developer's own checkout,
 * whose files can start anything: this repository's `.mcp.json` runs `npx -y chrome-devtools-mcp`
 * against the QA app's own CDP port. Automation therefore starts none of them unless the QA run
 * asks for them with `OPENWAGGLE_AUTOMATION_PROJECT_MCP=1`. Project overrides of global servers
 * still apply.
 */
export function connectsProjectMcpServers(
  environment: McpAutomationEnvironment = currentEnvironment(),
) {
  return (
    environment.OPENWAGGLE_AUTOMATION !== '1' ||
    environment.OPENWAGGLE_AUTOMATION_PROJECT_MCP === '1'
  )
}

/** The merge without the servers project files define, with a notice, when they may not connect. */
export function withProjectServerPolicy<T extends Pick<McpMergedConfig, 'servers' | 'errors'>>(
  merged: T,
  connectProjectServers: boolean,
): T {
  if (connectProjectServers) return merged
  const servers = merged.servers.filter((server) => server.scope !== 'project')
  if (servers.length === merged.servers.length) return merged
  return { ...merged, servers, errors: [AUTOMATION_PROJECT_MCP_NOTICE, ...merged.errors] }
}

/** The policy notice for a configured server that it leaves out. */
export function projectServerPolicyNotice(
  server: McpMergedServer | undefined,
  connectProjectServers: boolean,
) {
  return server?.scope === 'project' && !connectProjectServers
    ? AUTOMATION_PROJECT_MCP_NOTICE
    : undefined
}
