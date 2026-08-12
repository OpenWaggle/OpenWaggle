import { resolveMcpScopeState } from '../../domain/mcp/scope-policy'
import type { McpUserStateFile } from './config-types'

/** Resolve the effective global/project/session activation for a context. */
export function resolveIntegrationState(
  state: McpUserStateFile,
  projectPath: string | null,
  sessionId: string | null,
) {
  return resolveMcpScopeState({
    global: state.globalState,
    ...(projectPath ? { project: state.projectStates[projectPath] ?? 'inherit' } : {}),
    ...(sessionId ? { session: state.sessionStates[sessionId] ?? 'inherit' } : {}),
  })
}

/**
 * Whether an individual server is enabled for a given project. Overrides are
 * keyed by (projectPath, instanceId) and default to enabled, so muting a server
 * in one project can never affect another. `null` projectPath = enabled.
 */
export function projectServerEnabled(
  state: McpUserStateFile,
  projectPath: string | null,
  instanceId: string,
): boolean {
  if (!projectPath) return true
  return state.projectServerStates[projectPath]?.[instanceId] !== 'off'
}

/** Set (or clear, when enabling) a per-project override for one server. */
export function setProjectServerState(
  state: McpUserStateFile,
  projectPath: string,
  instanceId: string,
  enabled: boolean,
): McpUserStateFile {
  const current = { ...(state.projectServerStates[projectPath] ?? {}) }
  if (enabled) delete current[instanceId]
  else current[instanceId] = 'off'
  const projectServerStates = { ...state.projectServerStates }
  if (Object.keys(current).length === 0) delete projectServerStates[projectPath]
  else projectServerStates[projectPath] = current
  return { ...state, projectServerStates }
}
