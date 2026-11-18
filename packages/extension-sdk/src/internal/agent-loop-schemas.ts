import * as Schema from 'effect/Schema'
import { jsonValueSchema } from './json-schemas.js'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

export const openWaggleToolCallSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('tool'),
  toolCall: Schema.Struct({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    input: Schema.optionalWith(jsonValueSchema, { exact: true }),
  }),
  toolResult: Schema.optionalWith(
    Schema.Struct({
      ok: Schema.Boolean,
      output: Schema.optionalWith(jsonValueSchema, { exact: true }),
      error: Schema.optionalWith(Schema.String, { exact: true }),
    }),
    { exact: true },
  ),
})

export const openWaggleCustomMessageSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('custom-message'),
  message: Schema.Struct({
    name: nonEmptyStringSchema,
    payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
  }),
})

export const openWaggleInteractionSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('interaction'),
  interaction: Schema.Struct({
    id: nonEmptyStringSchema,
    customType: nonEmptyStringSchema,
    payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
  }),
})

export const openWaggleTranscriptSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('transcript'),
  transcript: Schema.Struct({
    sessionId: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
    messageCount: Schema.Number,
    payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
  }),
})

export const openWaggleStatusSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('status'),
  status: Schema.Struct({
    label: nonEmptyStringSchema,
    payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
  }),
})

export const openWaggleAgentLoopSurfaceInputSchema = Schema.Union(
  openWaggleToolCallSurfaceInputSchema,
  openWaggleCustomMessageSurfaceInputSchema,
  openWaggleInteractionSurfaceInputSchema,
  openWaggleTranscriptSurfaceInputSchema,
  openWaggleStatusSurfaceInputSchema,
)
