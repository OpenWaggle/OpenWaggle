import { SESSION_HOST_ERROR_KINDS } from '@shared/domain/session-host-refusals'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  isLocalSessionProfileCredential,
  LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH,
} from '@shared/types/local-session-profile'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import {
  localSessionProfileCapabilitiesSchema,
  localSessionProfileManagementEnvelopeSchema,
  localSessionProfileScopeSchema,
} from './local-session-profile'
import { sessionInputIdSchema } from './session-input'

const authorizationCeilingSchema = Schema.Literal(...AGENT_AUTHORIZATION_MODES)
const profileNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH),
  Schema.filter((value) => value.trim() === value || 'Profile names must be trimmed.'),
)
const profileCredentialSchema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      isLocalSessionProfileCredential(value) ||
      'Profile credentials must be 43-character base64url values.',
  ),
)

const profilePolicyFields = {
  capabilities: localSessionProfileCapabilitiesSchema,
  scope: localSessionProfileScopeSchema,
  authorizationCeiling: authorizationCeilingSchema,
  managementEnvelope: Schema.optionalWith(localSessionProfileManagementEnvelopeSchema, {
    exact: true,
  }),
}

export const localSessionProfileManagementCommandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('list') }),
  Schema.Struct({
    operation: Schema.Literal('create'),
    name: profileNameSchema,
    credential: profileCredentialSchema,
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    profileName: profileNameSchema,
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('rotate'),
    profileName: profileNameSchema,
    credential: profileCredentialSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('revoke'),
    profileName: profileNameSchema,
  }),
)

/** A profile command from the GUI; the Host mints the credential a create or rotate needs. */
export const localSessionProfileUiCommandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('list') }),
  Schema.Struct({
    operation: Schema.Literal('create'),
    name: profileNameSchema,
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    profileName: profileNameSchema,
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('rotate'),
    profileName: profileNameSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('revoke'),
    profileName: profileNameSchema,
  }),
)

export const localSessionProfileSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  ...profilePolicyFields,
  revokedAt: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  lastAuthenticatedAt: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  createdAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  updatedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

export const localSessionProfileManagementOutcomeSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    effect: Schema.Literal('profiles-listed'),
    profiles: Schema.Array(localSessionProfileSummarySchema),
  }),
  Schema.Struct({
    operation: Schema.Literal('create'),
    effect: Schema.Literal('profile-created'),
    profile: localSessionProfileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    effect: Schema.Literal('profile-updated'),
    profile: localSessionProfileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('rotate'),
    effect: Schema.Literal('profile-rotated'),
    profile: localSessionProfileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('revoke'),
    effect: Schema.Literal('profile-revoked'),
    profile: localSessionProfileSummarySchema,
    interruptedRuns: Schema.Array(
      Schema.Struct({ sessionId: Schema.String, runId: Schema.String }),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('list', 'create', 'update', 'rotate', 'revoke'),
    effect: Schema.Literal('rejected'),
    code: Schema.String,
    /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
    kind: Schema.Literal(...SESSION_HOST_ERROR_KINDS),
    profileName: Schema.optionalWith(Schema.String, { exact: true }),
  }),
)

export const localSessionProfileManagementRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  idempotencyKey: sessionInputIdSchema,
  command: localSessionProfileManagementCommandSchema,
})

export const localSessionProfileManagementResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  replayed: Schema.Boolean,
  outcome: localSessionProfileManagementOutcomeSchema,
})

export function decodeLocalSessionProfileManagementRequest(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementRequestSchema, value)
}

export function decodeLocalSessionProfileManagementResponse(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementResponseSchema, value)
}

export function decodeLocalSessionProfileManagementOutcome(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementOutcomeSchema, value)
}

export function decodeLocalSessionProfileUiCommand(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileUiCommandSchema, value)
}
