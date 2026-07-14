import * as Schema from 'effect/Schema'
import { type JsonValue, jsonValueSchema } from './json.js'

export interface OpenWaggleToolCallSurfaceInput {
  readonly surface: 'tool'
  readonly toolCall: {
    readonly id: string
    readonly name: string
    readonly input?: JsonValue
  }
  readonly toolResult?: {
    readonly ok: boolean
    readonly output?: JsonValue
    readonly error?: string
  }
}

export interface OpenWaggleCustomMessageSurfaceInput {
  readonly surface: 'custom-message'
  readonly message: {
    readonly name: string
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleInteractionSurfaceInput {
  readonly surface: 'interaction'
  readonly interaction: {
    readonly id: string
    readonly customType: string
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleTranscriptSurfaceInput {
  readonly surface: 'transcript'
  readonly transcript: {
    readonly sessionId?: string
    readonly messageCount: number
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleStatusSurfaceInput {
  readonly surface: 'status'
  readonly status: {
    readonly label: string
    readonly payload?: JsonValue
  }
}

export type OpenWaggleAgentLoopSurfaceInput =
  | OpenWaggleToolCallSurfaceInput
  | OpenWaggleCustomMessageSurfaceInput
  | OpenWaggleInteractionSurfaceInput
  | OpenWaggleTranscriptSurfaceInput
  | OpenWaggleStatusSurfaceInput

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

export const openWaggleToolCallSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('tool'),
  toolCall: Schema.Struct({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    input: Schema.optional(jsonValueSchema),
  }),
  toolResult: Schema.optional(
    Schema.Struct({
      ok: Schema.Boolean,
      output: Schema.optional(jsonValueSchema),
      error: Schema.optional(Schema.String),
    }),
  ),
})

export const openWaggleCustomMessageSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('custom-message'),
  message: Schema.Struct({
    name: nonEmptyStringSchema,
    payload: Schema.optional(jsonValueSchema),
  }),
})

export const openWaggleInteractionSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('interaction'),
  interaction: Schema.Struct({
    id: nonEmptyStringSchema,
    customType: nonEmptyStringSchema,
    payload: Schema.optional(jsonValueSchema),
  }),
})

export const openWaggleTranscriptSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('transcript'),
  transcript: Schema.Struct({
    sessionId: Schema.optional(nonEmptyStringSchema),
    messageCount: Schema.Number,
    payload: Schema.optional(jsonValueSchema),
  }),
})

export const openWaggleStatusSurfaceInputSchema = Schema.Struct({
  surface: Schema.Literal('status'),
  status: Schema.Struct({
    label: nonEmptyStringSchema,
    payload: Schema.optional(jsonValueSchema),
  }),
})

export const openWaggleAgentLoopSurfaceInputSchema = Schema.Union(
  openWaggleToolCallSurfaceInputSchema,
  openWaggleCustomMessageSurfaceInputSchema,
  openWaggleInteractionSurfaceInputSchema,
  openWaggleTranscriptSurfaceInputSchema,
  openWaggleStatusSurfaceInputSchema,
)
