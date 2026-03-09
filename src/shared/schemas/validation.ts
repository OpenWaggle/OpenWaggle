/**
 * Centralized Effect schemas for runtime boundary validation.
 *
 * Schemas here replace cast-heavy JSON.parse / IPC / external API boundaries.
 * Consumers should decode through `safeDecodeUnknown` / `decodeUnknownOrThrow`
 * from `src/shared/schema.ts`.
 */

import { Schema } from '@shared/schema'
import type { JsonArray, JsonObject, JsonValue } from '@shared/types/json'

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
  value: jsonValueSchema,
})

export const orchestrationTaskAttemptSchema = Schema.Struct({
  attempt: Schema.Number,
  status: Schema.Literal('ok', 'error', 'cancelled'),
  errorCode: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.String,
  durationMs: Schema.Number,
})

export const orchestrationTaskRetryPolicySchema = Schema.Struct({
  retries: Schema.Number,
  backoffMs: Schema.Number,
  jitterMs: Schema.Number,
})

export const taskToolProgressSchema = Schema.Struct({
  type: Schema.Literal('tool_start', 'tool_end'),
  toolName: Schema.String,
  toolCallId: Schema.String,
  toolInput: Schema.optional(jsonObjectSchema),
})

export const plannedTaskSchema = Schema.Struct(
  {
    id: Schema.String,
    kind: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    narration: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    dependsOn: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  },
  jsonLooseRecordSchema,
)

export const packageJsonSchema = Schema.Struct(
  {
    name: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    dependencies: Schema.optional(
      Schema.mutable(
        Schema.Record({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
    ),
    devDependencies: Schema.optional(
      Schema.mutable(
        Schema.Record({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
    ),
    scripts: Schema.optional(
      Schema.mutable(
        Schema.Record({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
    ),
  },
  jsonLooseRecordSchema,
)

const optionalUnknownFieldSchema = Schema.optional(Schema.Unknown)

export const qualityTierSchema = Schema.Struct({
  temperature: optionalUnknownFieldSchema,
  top_p: optionalUnknownFieldSchema,
  max_tokens: optionalUnknownFieldSchema,
})

export const projectSharedConfigSchema = Schema.Struct({
  quality: Schema.optional(
    Schema.Struct({
      low: Schema.optional(qualityTierSchema),
      medium: Schema.optional(qualityTierSchema),
      high: Schema.optional(qualityTierSchema),
    }),
  ),
})

const toolApprovalPatternSchema = Schema.Struct({
  pattern: Schema.String,
  timestamp: optionalUnknownFieldSchema,
  source: optionalUnknownFieldSchema,
})

const toolApprovalEntrySchema = Schema.Struct({
  trusted: optionalUnknownFieldSchema,
  timestamp: optionalUnknownFieldSchema,
  source: optionalUnknownFieldSchema,
  allowPatterns: Schema.optional(Schema.mutable(Schema.Array(toolApprovalPatternSchema))),
})

const toolsApprovalSchema = Schema.Struct({
  writeFile: Schema.optional(toolApprovalEntrySchema),
  editFile: Schema.optional(toolApprovalEntrySchema),
  runCommand: Schema.optional(toolApprovalEntrySchema),
  webFetch: Schema.optional(toolApprovalEntrySchema),
})

export const projectLocalConfigSchema = Schema.Struct({
  approvals: Schema.optional(
    Schema.Struct({
      tools: Schema.optional(toolsApprovalSchema),
    }),
  ),
})

export const ollamaTagsResponseSchema = Schema.Struct({
  models: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          name: Schema.String,
        }),
      ),
    ),
  ),
})

export const electronFileSchema = Schema.Struct({
  path: Schema.String,
})
