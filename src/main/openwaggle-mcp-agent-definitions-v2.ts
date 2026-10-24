import { discoverAgentDefinitions } from './agents/agent-definition-discovery'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'
import { assertProjectAllowed } from './openwaggle-mcp-workspace-policy'

type AgentDefinitionOperation = 'agent-definitions-list' | 'agent-definitions-search'

export function isMcpAgentDefinitionOperation(
  operation: SessionToolInputV2['operation'],
): operation is AgentDefinitionOperation {
  return operation === 'agent-definitions-list' || operation === 'agent-definitions-search'
}

/**
 * `agent-definitions-list` and `agent-definitions-search`, the hive tool's
 * `agent_definitions_list` and `agent_definitions_search`. Like the tool, they need no Session
 * capability and return names and descriptions only. The tool reads its own project; an MCP
 * caller reads a project inside its workspace grants, the first grant by default. They read
 * definition files in the server process, not the Session Host.
 */
export async function queryMcpAgentDefinitions(
  options: {
    readonly workspaceRoots: readonly string[]
    readonly sessionIds: ReadonlySet<string>
  },
  input: Pick<SessionToolInputV2, 'projectPath' | 'message' | 'limit'> & {
    readonly operation: AgentDefinitionOperation
  },
  dependencies: { readonly userHome?: string } = {},
) {
  const requested = input.projectPath ?? options.workspaceRoots[0]
  if (options.workspaceRoots.length === 0 || requested === undefined) {
    throw new Error('Agent-definition discovery requires an explicit MCP workspace grant.')
  }
  const projectPath = assertProjectAllowed(options, requested)
  if (input.operation === 'agent-definitions-search' && !input.message?.trim()) {
    throw new Error('message is required for agent-definitions-search.')
  }
  return discoverAgentDefinitions({
    projectPath,
    ...(input.operation === 'agent-definitions-search' && input.message
      ? { query: input.message }
      : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(dependencies.userHome ? { userHome: dependencies.userHome } : {}),
  })
}
