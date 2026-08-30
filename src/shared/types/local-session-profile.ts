import type { AgentAuthorizationMode } from './agent-authorization'
import type { SessionCapability } from './session-capability'

export interface LocalSessionProfileScope {
  readonly all?: boolean
  /** Canonical directory roots used only by machine-authenticated transient authorities. */
  readonly workspaceRoots?: readonly string[]
  /** Explicit roots within which Session exports may read resources and create artifacts. */
  readonly exportRoots?: readonly string[]
  /** Explicit roots from which Session commands may snapshot attachment files. */
  readonly attachmentRoots?: readonly string[]
  readonly projectPaths?: readonly string[]
  readonly sessionIds?: readonly string[]
  readonly hiveRootSessionIds?: readonly string[]
}

export interface LocalSessionProfileAuthority {
  readonly profileId: string
  readonly profileName: string
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
  readonly managementEnvelope?: LocalSessionProfileManagementEnvelope
}

export interface LocalSessionProfileManagementEnvelope {
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
}

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
}
