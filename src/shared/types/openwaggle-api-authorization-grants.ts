/**
 * Renderer-facing authorization grant API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit, and kept together because these
 * three calls are the whole surface Settings needs to show and revoke what a project has granted.
 */
import type {
  AgentAuthorizationScopeKey,
  ScopedAuthorizationGrant,
} from './agent-authorization-grants'

export interface OpenWaggleAuthorizationGrantApi {
  /** Every persistent grant recorded for a project. */
  listAuthorizationGrants(projectPath: string): Promise<ScopedAuthorizationGrant[]>
  /** Records a persistent grant, replacing any existing grant for the same key. */
  grantAuthorization(projectPath: string, key: AgentAuthorizationScopeKey): Promise<void>
  /** Removes a persistent grant. Applies from the next request, never retroactively. */
  revokeAuthorization(projectPath: string, key: AgentAuthorizationScopeKey): Promise<void>
}
