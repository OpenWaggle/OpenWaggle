import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
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

/** A named profile's scope. `workspaceRoots` belongs to transient authorities only. */
export const localSessionProfileScopeSchema = Schema.Struct({
  all: Schema.optional(Schema.Boolean),
  /** Explicit roots from which Session commands may snapshot attachment files. */
  attachmentRoots: Schema.optional(scopeValuesSchema),
  /** Explicit roots within which Session exports may read resources and create artifacts. */
  exportRoots: Schema.optional(scopeValuesSchema),
  projectPaths: Schema.optional(scopeValuesSchema),
  sessionIds: Schema.optional(scopeValuesSchema),
  hiveRootSessionIds: Schema.optional(scopeValuesSchema),
})

/** An authority's scope: a profile's, plus the canonical directory roots of a transient one. */
export const localSessionAuthorityScopeSchema = Schema.Struct({
  ...localSessionProfileScopeSchema.fields,
  /** Canonical directory roots used only by machine-authenticated transient authorities. */
  workspaceRoots: Schema.optional(scopeValuesSchema),
})

export const localSessionProfileCapabilitiesSchema = Schema.Array(
  Schema.Literal(...SESSION_CAPABILITIES),
).pipe(Schema.maxItems(SESSION_CAPABILITIES.length))

export const localSessionProfileManagementEnvelopeSchema = Schema.Struct({
  capabilities: localSessionProfileCapabilitiesSchema,
  scope: localSessionProfileScopeSchema,
  authorizationCeiling: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
})

export const localSessionProfileAuthoritySchema = Schema.Struct({
  profileId: Schema.String,
  profileName: Schema.String,
  capabilities: localSessionProfileCapabilitiesSchema,
  scope: localSessionAuthorityScopeSchema,
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
