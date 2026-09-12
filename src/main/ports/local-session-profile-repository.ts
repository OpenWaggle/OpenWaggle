import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type {
  LocalSessionProfileManagementRequest,
  LocalSessionProfileManagementResponse,
  LocalSessionProfileSummary,
} from '@shared/types/local-session-profile-management'
import type { SessionCapability } from '@shared/types/session-capability'
import { Context, type Effect } from 'effect'
import type { LocalSessionProfileRepositoryError } from '../errors'

export interface LocalSessionProfileAuthenticationRecord {
  readonly id: string
  readonly name: string
  readonly credentialVerifier: string
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
  readonly managementEnvelope?: LocalSessionProfileManagementEnvelope
  readonly revokedAt: number | null
}

export interface PreparedLocalSessionProfileCredential {
  readonly verifier: string
  readonly fingerprint: string
}

export interface LocalSessionProfileRepositoryShape {
  readonly list: () => Effect.Effect<
    readonly LocalSessionProfileSummary[],
    LocalSessionProfileRepositoryError
  >
  readonly findForAuthentication: (
    name: string,
  ) => Effect.Effect<
    LocalSessionProfileAuthenticationRecord | null,
    LocalSessionProfileRepositoryError
  >
  readonly findById: (
    id: string,
  ) => Effect.Effect<
    LocalSessionProfileAuthenticationRecord | null,
    LocalSessionProfileRepositoryError
  >
  readonly recordAuthentication: (input: {
    readonly profileId: string
    readonly accepted: boolean
    readonly clientKind: string
    readonly clientVersion: string
    readonly now: number
  }) => Effect.Effect<void, LocalSessionProfileRepositoryError>
  readonly executeManagement: (input: {
    readonly actorCallerId: string
    readonly request: LocalSessionProfileManagementRequest
    readonly preparedCredential?: PreparedLocalSessionProfileCredential
    readonly now: number
  }) => Effect.Effect<LocalSessionProfileManagementResponse, LocalSessionProfileRepositoryError>
}

export class LocalSessionProfileRepository extends Context.Tag(
  '@openwaggle/LocalSessionProfileRepository',
)<LocalSessionProfileRepository, LocalSessionProfileRepositoryShape>() {}
