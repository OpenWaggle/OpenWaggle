/**
 * Centralized Effect schemas for runtime boundary validation.
 *
 * Schemas here replace cast-heavy JSON.parse / IPC / external API boundaries.
 * Consumers should decode through `safeDecodeUnknown` / `decodeUnknownOrThrow`
 * from `src/shared/schema.ts`.
 */

import { Schema, type SchemaType } from '@shared/schema'
import type { AgentSendPayload } from '@shared/types/agent'
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

export const agentSendPayloadSchema = Schema.Struct({
  text: Schema.String,
  thinkingLevel: Schema.Literal(...THINKING_LEVELS),
  attachments: Schema.mutable(Schema.Array(preparedAttachmentSchema)),
  waggle: Schema.optional(waggleInvocationSchema),
})

export function toAgentSendPayload(
  input: SchemaType<typeof agentSendPayloadSchema>,
): AgentSendPayload {
  return {
    text: input.text,
    thinkingLevel: input.thinkingLevel,
    attachments: input.attachments,
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
  }
}

export const projectPreferencesSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
})

export const projectSettingsFileSchema = Schema.Struct(
  {
    preferences: Schema.optional(projectPreferencesSchema),
    pi: Schema.optional(jsonObjectSchema),
  },
  jsonLooseRecordSchema,
)
