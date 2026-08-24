/**
 * Authorization grant IPC channels.
 *
 * Kept in their own map rather than appended to the core map, which sits at the 300-line limit, and
 * because grants are a self-contained surface: list what a project has granted, add one, revoke one.
 */
import type {
  AgentAuthorizationScopeKey,
  ScopedAuthorizationGrant,
} from './agent-authorization-grants'

export interface IpcAuthorizationGrantInvokeChannelMap {
  /** Every persistent grant recorded for a project, for the Settings list. */
  'authorization-grants:list': {
    args: [projectPath: string]
    return: ScopedAuthorizationGrant[]
  }
  /** Records a persistent grant, replacing any existing grant for the same key. */
  'authorization-grants:grant': {
    args: [projectPath: string, key: AgentAuthorizationScopeKey]
    return: undefined
  }
  /** Removes a persistent grant. Applies from the next request, never retroactively. */
  'authorization-grants:revoke': {
    args: [projectPath: string, key: AgentAuthorizationScopeKey]
    return: undefined
  }
}
