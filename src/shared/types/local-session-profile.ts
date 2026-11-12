import type { SchemaType } from '@shared/schema'
import type {
  localSessionAuthorityScopeSchema,
  localSessionProfileAuthoritySchema,
  localSessionProfileManagementEnvelopeSchema,
} from '@shared/schemas/local-session-profile'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { SessionCapability } from './session-capability'

export const LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH = 128
export const LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT = 128
export const LOCAL_SESSION_PROFILE_SCOPE_VALUE_MAX_LENGTH = 4096
const LOCAL_SESSION_PROFILE_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isLocalSessionProfileCredential(value: string) {
  return LOCAL_SESSION_PROFILE_CREDENTIAL_PATTERN.test(value)
}

/** Every root and id a caller is scoped to; only a transient authority holds `workspaceRoots`. */
export type LocalSessionProfileScope = SchemaType<typeof localSessionAuthorityScopeSchema>
export type LocalSessionProfileAuthority = SchemaType<typeof localSessionProfileAuthoritySchema>
export type LocalSessionProfileManagementEnvelope = SchemaType<
  typeof localSessionProfileManagementEnvelopeSchema
>

export interface LocalSessionCallerIdentity {
  readonly callerId: string
  readonly workingDirectory?: string
  readonly profileAuthority?: LocalSessionProfileAuthority
  /** Live, non-transferable child authority derived for this authenticated caller. */
  readonly derivedSessionAuthorities?: readonly {
    readonly sessionId: string
    readonly capabilities: readonly SessionCapability[]
    readonly authorizationCeiling: AgentAuthorizationMode
  }[]
  /** Original named-profile scope before derived child targets are projected into it. */
  readonly baseProfileScope?: LocalSessionProfileScope
  /** Live Session ids admitted by the base profile scope; derived grants remain capability-bound. */
  readonly eventAdmissionSessionIds?: readonly string[]
  /**
   * Grants an `openwaggle mcp serve --profile` server holds on top of the named profile. The Host
   * intersects them with the profile's live policy each time it refreshes the caller, so they
   * can only narrow it.
   */
  readonly profileNarrowing?: LocalSessionProfileAuthority
  /**
   * Authority this caller never exceeds, whatever its identity holds live. A Scheduled task a
   * Session agent created runs as the agent's owner within the agent's authority at creation
   * (ADR 0058), and the Host applies these again each time it refreshes the caller.
   */
  readonly authorityLimits?: LocalSessionAuthorityLimits
}

/** Capabilities, scope and Authorization ceiling a caller is held within. */
export type LocalSessionAuthorityLimits = LocalSessionProfileManagementEnvelope
