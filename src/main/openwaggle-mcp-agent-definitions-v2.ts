import {
  type AgentDefinitionProjectResolver,
  resolveAgentDefinitionProject,
} from './agent-definition-project'
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
 * capability, return names and descriptions only, and leave out definitions turned off for the
 * project, which spawn and launch refuse. The tool reads its own project; an MCP
 * caller names a directory inside its workspace grants, the first grant by default, and reads
 * the OpenWaggle project that directory belongs to. They read definition files in the server
 * process, not the Session Host.
 */
export async function queryMcpAgentDefinitions(
  options: {
    readonly workspaceRoots: readonly string[]
    readonly sessionIds: ReadonlySet<string>
  },
  input: Pick<SessionToolInputV2, 'projectPath' | 'message' | 'limit'> & {
    readonly operation: AgentDefinitionOperation
  },
  dependencies: {
    readonly userHome?: string
    readonly resolveProject?: AgentDefinitionProjectResolver
  } = {},
) {
  const requested = input.projectPath ?? options.workspaceRoots[0]
  if (options.workspaceRoots.length === 0 || requested === undefined) {
    throw new Error('Agent-definition discovery requires an explicit MCP workspace grant.')
  }
  const grantedPath = assertProjectAllowed(options, requested)
  if (input.operation === 'agent-definitions-search' && !input.message?.trim()) {
    throw new Error('message is required for agent-definitions-search.')
  }
  // A grant on a managed worktree or a subdirectory reads its project, as spawn and launch do.
  const { projectPath, enabledByName } = await (
    dependencies.resolveProject ?? resolveAgentDefinitionProject
  )(grantedPath)
  return discoverAgentDefinitions({
    projectPath,
    enabledByName,
    ...(input.operation === 'agent-definitions-search' && input.message
      ? { query: input.message }
      : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(dependencies.userHome ? { userHome: dependencies.userHome } : {}),
  })
}
