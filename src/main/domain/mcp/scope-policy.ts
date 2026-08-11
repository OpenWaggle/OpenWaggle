import type {
  McpEffectiveState,
  McpScope,
  McpScopeResolution,
  McpScopeState,
} from '@shared/types/mcp'

function inheritedState(state: McpScopeState, fallback: McpEffectiveState): McpEffectiveState {
  return state === 'inherit' ? fallback : state
}

export function resolveMcpScopeState(input: {
  readonly global: Exclude<McpScopeState, 'inherit'>
  readonly project?: McpScopeState
  readonly session?: McpScopeState
}): McpScopeResolution {
  const project = input.project ?? 'inherit'
  const session = input.session ?? 'inherit'
  const projectEffective = inheritedState(project, input.global)
  const effective = inheritedState(session, projectEffective)
  const source: McpScope =
    session !== 'inherit' ? 'session' : project !== 'inherit' ? 'project' : 'global'

  return {
    global: input.global,
    project,
    session,
    effective,
    source,
  }
}

export function validateMcpScopeMutation(input: {
  readonly scope: McpScope
  readonly state: McpScopeState
  readonly projectPath?: string | null
  readonly sessionId?: string | null
}) {
  if (input.scope === 'global' && input.state === 'inherit') {
    return 'Global MCP state cannot inherit.'
  }
  if (input.scope === 'project' && !input.projectPath?.trim()) {
    return 'A project path is required for a project MCP override.'
  }
  if (input.scope === 'session' && !input.sessionId?.trim()) {
    return 'A session id is required for a session MCP override.'
  }
  return null
}
