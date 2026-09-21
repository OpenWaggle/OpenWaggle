import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import type {
  LocalSessionProfileAuthority,
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT,
  LOCAL_SESSION_PROFILE_SCOPE_VALUE_MAX_LENGTH,
} from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'

const scopeValueSchema = Schema.String.pipe(
  Schema.maxLength(LOCAL_SESSION_PROFILE_SCOPE_VALUE_MAX_LENGTH),
)
const scopeValuesSchema = Schema.Array(scopeValueSchema).pipe(
  Schema.maxItems(LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT),
)

export const localSessionProfileScopeSchema: Schema.Schema<LocalSessionProfileScope> =
  Schema.Struct({
    all: Schema.optional(Schema.Boolean),
    attachmentRoots: Schema.optional(scopeValuesSchema),
    exportRoots: Schema.optional(scopeValuesSchema),
    projectPaths: Schema.optional(scopeValuesSchema),
    sessionIds: Schema.optional(scopeValuesSchema),
    hiveRootSessionIds: Schema.optional(scopeValuesSchema),
  })

export const localSessionProfileCapabilitiesSchema = Schema.Array(
  Schema.Literal(...SESSION_CAPABILITIES),
).pipe(Schema.maxItems(SESSION_CAPABILITIES.length))

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
      workspaceRoots: Schema.optional(scopeValuesSchema),
      attachmentRoots: Schema.optional(scopeValuesSchema),
      exportRoots: Schema.optional(scopeValuesSchema),
      projectPaths: Schema.optional(scopeValuesSchema),
      sessionIds: Schema.optional(scopeValuesSchema),
      hiveRootSessionIds: Schema.optional(scopeValuesSchema),
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
