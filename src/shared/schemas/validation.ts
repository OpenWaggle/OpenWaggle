/**
 * Centralized Effect schemas for runtime boundary validation.
 *
 * Schemas here replace cast-heavy JSON.parse / IPC / external API boundaries.
 * Consumers should decode through `safeDecodeUnknown` / `decodeUnknownOrThrow`
 * from `src/shared/schema.ts`.
 */

import { MAX_INLINE_VISUALIZATION_PATH_LENGTH } from '@shared/constants/inline-visualization'
import { Schema, type SchemaType } from '@shared/schema'
import type { AgentSendPayload } from '@shared/types/agent'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { AGENT_AUTHORIZATION_CAPABILITIES } from '@shared/types/agent-authorization-grants'
import type { JsonArray, JsonObject, JsonValue } from '@shared/types/json'
import { THINKING_LEVELS } from '@shared/types/settings'
import { toWaggleInvocation, waggleInvocationSchema } from './waggle'

const attachmentKindSchema = Schema.Literal('text', 'image', 'pdf')
const attachmentOriginSchema = Schema.Literal('user-file', 'auto-paste-text')

const jsonArraySchema: Schema.Schema<JsonArray> = Schema.suspend(() =>
  Schema.mutable(Schema.Array(jsonValueSchema)),
)

export const jsonObjectSchema: Schema.Schema<JsonObject> = Schema.suspend(() =>
  Schema.mutable(
    Schema.Record({
      key: Schema.String,
      value: jsonValueSchema,
    }),
  ),
)

export const jsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    jsonArraySchema,
    jsonObjectSchema,
  ),
)

const jsonLooseRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
})

export const preparedAttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: attachmentKindSchema,
  origin: Schema.optional(attachmentOriginSchema),
  name: Schema.String,
  path: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  extractedText: Schema.String,
})

const MAX_INLINE_VISUALIZATION_STATE_BYTES = 16 * 1024
const MAX_INLINE_VISUALIZATION_TITLE_LENGTH = 250
const inlineVisualizationStateSchema = jsonValueSchema.pipe(
  Schema.filter((value) => {
    try {
      return (
        new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        MAX_INLINE_VISUALIZATION_STATE_BYTES
      )
    } catch {
      return false
    }
  }),
)

export const agentSendPayloadSchema = Schema.Struct({
  text: Schema.String,
  thinkingLevel: Schema.Literal(...THINKING_LEVELS),
  attachments: Schema.mutable(Schema.Array(preparedAttachmentSchema)),
  waggle: Schema.optional(waggleInvocationSchema),
  visualizationContext: Schema.optional(
    Schema.Struct({
      title: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_TITLE_LENGTH)),
      sourcePath: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_PATH_LENGTH)),
      state: inlineVisualizationStateSchema,
    }),
  ),
})

export function toAgentSendPayload(
  input: SchemaType<typeof agentSendPayloadSchema>,
): AgentSendPayload {
  return {
    text: input.text,
    thinkingLevel: input.thinkingLevel,
    attachments: input.attachments,
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  }
}

export const projectPreferencesSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  authorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

/** A preference write where `null` clears the key. Distinct from the read schema, which has no nulls. */
export const projectPreferencesUpdateSchema = Schema.Struct({
  model: Schema.optional(Schema.NullOr(Schema.String)),
  thinkingLevel: Schema.optional(Schema.NullOr(Schema.Literal(...THINKING_LEVELS))),
  authorizationMode: Schema.optional(Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES))),
})

export const authorizationScopeKeySchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optional(Schema.String),
})

export const scopedAuthorizationGrantSchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optional(Schema.String),
  grantedAt: Schema.Number,
})

export const projectSettingsFileSchema = Schema.Struct(
  {
    preferences: Schema.optional(projectPreferencesSchema),
    authorizationGrants: Schema.optional(
      Schema.mutable(Schema.Array(scopedAuthorizationGrantSchema)),
    ),
    pi: Schema.optional(jsonObjectSchema),
  },
  jsonLooseRecordSchema,
)
