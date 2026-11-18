import { Schema } from '@shared/schema'
import { jsonValueSchema } from './validation'

/**
 * The assistant-message events a `message_update` transport event carries, and the error info
 * transport events share. The single source of those types in `@shared/types/stream`.
 */

export const agentTransportErrorInfoSchema = Schema.Struct({
  message: Schema.String,
  code: Schema.optionalWith(Schema.String, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  stack: Schema.optionalWith(Schema.String, { exact: true }),
})

const contentIndex = { contentIndex: Schema.Number }

export const agentAssistantTextStartEventSchema = Schema.Struct({
  type: Schema.Literal('text_start'),
  ...contentIndex,
})

export const agentAssistantTextDeltaEventSchema = Schema.Struct({
  type: Schema.Literal('text_delta'),
  ...contentIndex,
  delta: Schema.String,
})

export const agentAssistantTextEndEventSchema = Schema.Struct({
  type: Schema.Literal('text_end'),
  ...contentIndex,
  content: Schema.String,
})

export const agentAssistantThinkingStartEventSchema = Schema.Struct({
  type: Schema.Literal('thinking_start'),
  ...contentIndex,
})

export const agentAssistantThinkingDeltaEventSchema = Schema.Struct({
  type: Schema.Literal('thinking_delta'),
  ...contentIndex,
  delta: Schema.String,
})

export const agentAssistantThinkingEndEventSchema = Schema.Struct({
  type: Schema.Literal('thinking_end'),
  ...contentIndex,
  content: Schema.String,
})

export const agentAssistantToolCallStartEventSchema = Schema.Struct({
  type: Schema.Literal('toolcall_start'),
  ...contentIndex,
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: Schema.optionalWith(jsonValueSchema, { exact: true }),
})

/**
 * Sent when a streaming tool call's parsed input changed. `delta` is the raw argument text
 * since the previous `toolcall_delta` of this call, and `input` the whole input so far. Raw
 * text after the last change is not sent as a delta: `toolcall_end` carries the exact final
 * input.
 */
export const agentAssistantToolCallDeltaEventSchema = Schema.Struct({
  type: Schema.Literal('toolcall_delta'),
  ...contentIndex,
  toolCallId: Schema.String,
  delta: Schema.String,
  input: Schema.optionalWith(jsonValueSchema, { exact: true }),
})

export const agentAssistantToolCallEndEventSchema = Schema.Struct({
  type: Schema.Literal('toolcall_end'),
  ...contentIndex,
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: jsonValueSchema,
})

export const agentAssistantDoneEventSchema = Schema.Struct({
  type: Schema.Literal('done'),
  reason: Schema.Literal('stop', 'length', 'toolUse'),
})

export const agentAssistantErrorEventSchema = Schema.Struct({
  type: Schema.Literal('error'),
  reason: Schema.Literal('aborted', 'error'),
  error: agentTransportErrorInfoSchema,
})

export const agentAssistantMessageEventSchema = Schema.Union(
  agentAssistantTextStartEventSchema,
  agentAssistantTextDeltaEventSchema,
  agentAssistantTextEndEventSchema,
  agentAssistantThinkingStartEventSchema,
  agentAssistantThinkingDeltaEventSchema,
  agentAssistantThinkingEndEventSchema,
  agentAssistantToolCallStartEventSchema,
  agentAssistantToolCallDeltaEventSchema,
  agentAssistantToolCallEndEventSchema,
  agentAssistantDoneEventSchema,
  agentAssistantErrorEventSchema,
)
