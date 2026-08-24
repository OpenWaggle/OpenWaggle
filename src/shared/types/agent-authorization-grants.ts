import type { AgentAuthorizationMode } from './agent-authorization'

/**
 * The capabilities an authorization request can ask for.
 *
 * Deliberately closed. A new capability has to be added here and declared at its call site, which
 * is what stops a request from arriving with an unrecognised capability and being matched against a
 * grant the user never meant to give.
 */
export const AGENT_AUTHORIZATION_CAPABILITIES = ['mcp.tool-call', 'mcp.sampling'] as const

export type AgentAuthorizationCapability = (typeof AGENT_AUTHORIZATION_CAPABILITIES)[number]

export function isAgentAuthorizationCapability(
  value: unknown,
): value is AgentAuthorizationCapability {
  return AGENT_AUTHORIZATION_CAPABILITIES.some((capability) => capability === value)
}

/**
 * What a grant is bound to.
 *
 * Follows Codex's `McpToolApprovalKey { server, connector_id, tool_name }`: the requester, a stable id
 * for it, and the exact resource, never the arguments. Keying on arguments would split one intent
 * across every argument combination and let attacker-controlled values decide whether a grant applies.
 *
 * `requesterId` is the identity; `requester` is the display name and is deliberately NOT part of
 * matching. The first version keyed on the name alone, which had one harmless failure and one unsafe
 * one: renaming a server dropped its grants, which merely re-prompts, but giving a different server
 * config a name a previous one used silently handed it every grant the old one held. A grant must not
 * move because a label was reused.
 *
 * `resource` is absent for capabilities that have no sub-resource worth naming, such as sampling,
 * where the requester and the capability are the whole identity.
 */
export interface AgentAuthorizationScopeKey {
  readonly requester: string
  readonly requesterId: string
  readonly capability: AgentAuthorizationCapability
  readonly resource?: string
}

/** A persisted grant, with the moment it was given so Settings can show it. */
export interface ScopedAuthorizationGrant extends AgentAuthorizationScopeKey {
  readonly grantedAt: number
}

/**
 * How far an approval reaches.
 *
 * `once` leaves nothing behind. `session` lives only in memory for the current session. `project`
 * is written to the project config and survives restarts until revoked.
 */
export const AGENT_AUTHORIZATION_DECISION_SCOPES = ['once', 'session', 'project'] as const

export type AgentAuthorizationDecisionScope = (typeof AGENT_AUTHORIZATION_DECISION_SCOPES)[number]

export function isAgentAuthorizationDecisionScope(
  value: unknown,
): value is AgentAuthorizationDecisionScope {
  return AGENT_AUTHORIZATION_DECISION_SCOPES.some((scope) => scope === value)
}

/**
 * Stable string form of a key, for map lookups and for comparing two keys.
 *
 * Built from `requesterId`, never the display name, so a rename neither drops a grant nor lets a
 * reused name inherit one.
 */
export function authorizationScopeKeyId(key: AgentAuthorizationScopeKey): string {
  return `${key.capability}\u0000${key.requesterId}\u0000${key.resource ?? ''}`
}

/**
 * Whether two keys are the same grant.
 *
 * An absent `resource` matches only another absent `resource`. It is never a wildcard, so a grant
 * for one tool cannot be stretched to cover a server's whole tool list, including tools the server
 * adds in a later version.
 */
export function authorizationScopeKeysMatch(
  left: AgentAuthorizationScopeKey,
  right: AgentAuthorizationScopeKey,
): boolean {
  return authorizationScopeKeyId(left) === authorizationScopeKeyId(right)
}

/** Finds the grant covering a key, or `undefined` when the user has granted nothing for it. */
export function findMatchingGrant(
  grants: readonly ScopedAuthorizationGrant[],
  key: AgentAuthorizationScopeKey,
): ScopedAuthorizationGrant | undefined {
  return grants.find((grant) => authorizationScopeKeysMatch(grant, key))
}

/** Human-readable label for a capability, for prompts and the Settings list. */
export const AGENT_AUTHORIZATION_CAPABILITY_LABELS = {
  'mcp.tool-call': 'Run a tool',
  'mcp.sampling': 'Use your model',
} satisfies Record<AgentAuthorizationCapability, string>

/** Modes in which a matching grant is consulted at all. */
export function modeConsultsGrants(mode: AgentAuthorizationMode): boolean {
  return mode === 'ask-for-approval'
}
