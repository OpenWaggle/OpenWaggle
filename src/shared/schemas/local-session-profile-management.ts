import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementRequest,
  type LocalSessionProfileManagementResponse,
  type LocalSessionProfileUiCommand,
} from '@shared/types/local-session-profile-management'
import {
  localSessionProfileCapabilitiesSchema,
  localSessionProfileManagementEnvelopeSchema,
  localSessionProfileScopeSchema,
} from './local-session-profile'

const authorizationCeilingSchema = Schema.Literal(...AGENT_AUTHORIZATION_MODES)

const profilePolicyFields = {
  capabilities: localSessionProfileCapabilitiesSchema,
  scope: localSessionProfileScopeSchema,
  authorizationCeiling: authorizationCeilingSchema,
  managementEnvelope: Schema.optional(localSessionProfileManagementEnvelopeSchema),
}

const commandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('list') }),
  Schema.Struct({
    operation: Schema.Literal('create'),
    name: Schema.String.pipe(Schema.minLength(1)),
    credential: Schema.String.pipe(Schema.minLength(1)),
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    profileName: Schema.String.pipe(Schema.minLength(1)),
    ...profilePolicyFields,
  }),
  Schema.Struct({
    operation: Schema.Literal('rotate'),
    profileName: Schema.String.pipe(Schema.minLength(1)),
    credential: Schema.String.pipe(Schema.minLength(1)),
  }),
  Schema.Struct({
    operation: Schema.Literal('revoke'),
    profileName: Schema.String.pipe(Schema.minLength(1)),
  }),
)

export const localSessionProfileUiCommandSchema: Schema.Schema<LocalSessionProfileUiCommand> =
  Schema.Union(
    Schema.Struct({ operation: Schema.Literal('list') }),
    Schema.Struct({
      operation: Schema.Literal('create'),
      name: Schema.String.pipe(Schema.minLength(1)),
      ...profilePolicyFields,
    }),
    Schema.Struct({
      operation: Schema.Literal('update'),
      profileName: Schema.String.pipe(Schema.minLength(1)),
      ...profilePolicyFields,
    }),
    Schema.Struct({
      operation: Schema.Literal('rotate'),
      profileName: Schema.String.pipe(Schema.minLength(1)),
    }),
    Schema.Struct({
      operation: Schema.Literal('revoke'),
      profileName: Schema.String.pipe(Schema.minLength(1)),
    }),
  )

const profileSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  ...profilePolicyFields,
  revokedAt: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  lastAuthenticatedAt: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  createdAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  updatedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const outcomeSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    effect: Schema.Literal('profiles-listed'),
    profiles: Schema.Array(profileSummarySchema),
  }),
  Schema.Struct({
    operation: Schema.Literal('create'),
    effect: Schema.Literal('profile-created'),
    profile: profileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    effect: Schema.Literal('profile-updated'),
    profile: profileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('rotate'),
    effect: Schema.Literal('profile-rotated'),
    profile: profileSummarySchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('revoke'),
    effect: Schema.Literal('profile-revoked'),
    profile: profileSummarySchema,
    interruptedRuns: Schema.Array(
      Schema.Struct({ sessionId: Schema.String, runId: Schema.String }),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('list', 'create', 'update', 'rotate', 'revoke'),
    effect: Schema.Literal('rejected'),
    code: Schema.String,
    profileName: Schema.optional(Schema.String),
  }),
)

export const localSessionProfileManagementRequestSchema: Schema.Schema<LocalSessionProfileManagementRequest> =
  Schema.Struct({
    contractVersion: Schema.Literal(LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION),
    requestId: Schema.String,
    idempotencyKey: Schema.String,
    command: commandSchema,
  })

export const localSessionProfileManagementResponseSchema: Schema.Schema<LocalSessionProfileManagementResponse> =
  Schema.Struct({
    contractVersion: Schema.Literal(LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION),
    requestId: Schema.String,
    idempotencyKey: Schema.String,
    replayed: Schema.Boolean,
    outcome: outcomeSchema,
  })

export function decodeLocalSessionProfileManagementRequest(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementRequestSchema, value)
}

export function decodeLocalSessionProfileManagementResponse(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileManagementResponseSchema, value)
}

export function decodeLocalSessionProfileManagementOutcome(value: unknown) {
  return decodeUnknownExactOrThrow(outcomeSchema, value)
}

export function decodeLocalSessionProfileUiCommand(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionProfileUiCommandSchema, value)
}
