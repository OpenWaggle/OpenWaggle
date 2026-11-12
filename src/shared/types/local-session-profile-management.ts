import type { SessionHostErrorKind } from '../domain/session-host-refusals'
import type { AgentAuthorizationMode } from './agent-authorization'
import type {
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from './local-session-profile'
import type { SessionCapability } from './session-capability'

export const LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION = 1 as const

export interface LocalSessionProfileSummary {
  readonly id: string
  readonly name: string
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
  readonly managementEnvelope?: LocalSessionProfileManagementEnvelope | undefined
  readonly revokedAt: number | null
  readonly lastAuthenticatedAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type LocalSessionProfileManagementCommand =
  | { readonly operation: 'list' }
  | {
      readonly operation: 'create'
      readonly name: string
      readonly credential: string
      readonly capabilities: readonly SessionCapability[]
      readonly scope: LocalSessionProfileScope
      readonly authorizationCeiling: AgentAuthorizationMode
      readonly managementEnvelope?: LocalSessionProfileManagementEnvelope | undefined
    }
  | {
      readonly operation: 'update'
      readonly profileName: string
      readonly capabilities: readonly SessionCapability[]
      readonly scope: LocalSessionProfileScope
      readonly authorizationCeiling: AgentAuthorizationMode
      readonly managementEnvelope?: LocalSessionProfileManagementEnvelope | undefined
    }
  | {
      readonly operation: 'rotate'
      readonly profileName: string
      readonly credential: string
    }
  | { readonly operation: 'revoke'; readonly profileName: string }

export interface LocalSessionProfileManagementRequest {
  readonly contractVersion: typeof LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly command: LocalSessionProfileManagementCommand
}

export type LocalSessionProfileManagementOutcome =
  | {
      readonly operation: 'list'
      readonly effect: 'profiles-listed'
      readonly profiles: readonly LocalSessionProfileSummary[]
    }
  | {
      readonly operation: 'create'
      readonly effect: 'profile-created'
      readonly profile: LocalSessionProfileSummary
    }
  | {
      readonly operation: 'update'
      readonly effect: 'profile-updated'
      readonly profile: LocalSessionProfileSummary
    }
  | {
      readonly operation: 'rotate'
      readonly effect: 'profile-rotated'
      readonly profile: LocalSessionProfileSummary
    }
  | {
      readonly operation: 'revoke'
      readonly effect: 'profile-revoked'
      readonly profile: LocalSessionProfileSummary
      readonly interruptedRuns: readonly { readonly sessionId: string; readonly runId: string }[]
    }
  | {
      readonly operation: LocalSessionProfileManagementCommand['operation']
      readonly effect: 'rejected'
      readonly code: string
      /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
      readonly kind: SessionHostErrorKind
      readonly profileName?: string | undefined
    }

export interface LocalSessionProfileManagementResponse {
  readonly contractVersion: typeof LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly replayed: boolean
  readonly outcome: LocalSessionProfileManagementOutcome
}

export type LocalSessionProfileUiCommand =
  | { readonly operation: 'list' }
  | {
      readonly operation: 'create'
      readonly name: string
      readonly capabilities: readonly SessionCapability[]
      readonly scope: LocalSessionProfileScope
      readonly authorizationCeiling: AgentAuthorizationMode
      readonly managementEnvelope?: LocalSessionProfileManagementEnvelope | undefined
    }
  | {
      readonly operation: 'update'
      readonly profileName: string
      readonly capabilities: readonly SessionCapability[]
      readonly scope: LocalSessionProfileScope
      readonly authorizationCeiling: AgentAuthorizationMode
      readonly managementEnvelope?: LocalSessionProfileManagementEnvelope | undefined
    }
  | { readonly operation: 'rotate'; readonly profileName: string }
  | { readonly operation: 'revoke'; readonly profileName: string }
