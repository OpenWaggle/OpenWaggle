import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import type {
  LocalSessionProfileAuthority,
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'

export const localSessionProfileScopeSchema: Schema.Schema<LocalSessionProfileScope> =
  Schema.Struct({
    all: Schema.optional(Schema.Boolean),
    attachmentRoots: Schema.optional(Schema.Array(Schema.String)),
    exportRoots: Schema.optional(Schema.Array(Schema.String)),
    projectPaths: Schema.optional(Schema.Array(Schema.String)),
    sessionIds: Schema.optional(Schema.Array(Schema.String)),
    hiveRootSessionIds: Schema.optional(Schema.Array(Schema.String)),
  })

export const localSessionProfileCapabilitiesSchema = Schema.Array(
  Schema.Literal(...SESSION_CAPABILITIES),
)

export const localSessionProfileManagementEnvelopeSchema: Schema.Schema<LocalSessionProfileManagementEnvelope> =
  Schema.Struct({
    capabilities: localSessionProfileCapabilitiesSchema,
    scope: localSessionProfileScopeSchema,
    authorizationCeiling: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
  })

export const localSessionProfileAuthoritySchema: Schema.Schema<LocalSessionProfileAuthority> =
  Schema.Struct({
    profileId: Schema.String,
    profileName: Schema.String,
    capabilities: localSessionProfileCapabilitiesSchema,
    scope: Schema.Struct({
      all: Schema.optional(Schema.Boolean),
      workspaceRoots: Schema.optional(Schema.Array(Schema.String)),
      attachmentRoots: Schema.optional(Schema.Array(Schema.String)),
      exportRoots: Schema.optional(Schema.Array(Schema.String)),
      projectPaths: Schema.optional(Schema.Array(Schema.String)),
      sessionIds: Schema.optional(Schema.Array(Schema.String)),
      hiveRootSessionIds: Schema.optional(Schema.Array(Schema.String)),
    }),
    authorizationCeiling: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
    managementEnvelope: Schema.optional(localSessionProfileManagementEnvelopeSchema),
  })

export function decodeLocalSessionProfileScope(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileScopeSchema, value)
}

export function decodeLocalSessionProfileCapabilities(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileCapabilitiesSchema, value)
}

export function decodeLocalSessionProfileManagementEnvelope(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementEnvelopeSchema, value)
}
