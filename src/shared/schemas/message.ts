/**
 * A transcript message and its parts: the single source of `Message`, `MessagePart` and the tool
 * call types in `@shared/types/agent` and `@shared/types/tools`. Active Run snapshots decode parts
 * with `messagePartSchema`; the persisted Session detail reader decodes its rows into this shape.
 */
import { Schema } from '@shared/schema'
import {
  messageIdSchema,
  sessionIdSchema,
  supportedModelIdSchema,
  toolCallIdSchema,
} from '@shared/types/brand'
import { messageScheduledTaskOriginSchema } from './message-scheduled-task-origin'
import { nestedToolCallsSchema } from './nested-tool-calls'
import { jsonValueSchema, preparedAttachmentSchema } from './validation'
import { waggleInvocationMetadataSchema, waggleMetadataSchema } from './waggle'

/** Tool arguments: a JSON object, read only. */
const toolArgsSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema })

export const toolCallRequestSchema = Schema.Struct({
  id: toolCallIdSchema,
  name: Schema.String,
  args: toolArgsSchema,
  state: Schema.optionalWith(Schema.Literal('input-complete'), { exact: true }),
  /** Nested calls seen live while the call ran, kept in the active Run buffer for reconnects. */
  nestedCalls: Schema.optionalWith(nestedToolCallsSchema, { exact: true }),
})

export const toolCallResultSchema = Schema.Struct({
  id: toolCallIdSchema,
  name: Schema.String,
  args: toolArgsSchema,
  result: jsonValueSchema,
  isError: Schema.Boolean,
  /** Duration in ms */
  duration: Schema.Number,
  details: Schema.optionalWith(jsonValueSchema, { exact: true }),
  nestedCalls: Schema.optionalWith(nestedToolCallsSchema, { exact: true }),
})

export const textPartSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  /**
   * The content block it streamed from, kept by the Host stream buffer only (absent from older
   * Hosts and persisted messages): the renderer matches buffered and shown parts by it.
   */
  contentIndex: Schema.optionalWith(Schema.Number, { exact: true }),
})

export const reasoningPartSchema = Schema.Struct({
  type: Schema.Literal('reasoning'),
  text: Schema.String,
  /** The content block it streamed from, as `TextPart.contentIndex`. */
  contentIndex: Schema.optionalWith(Schema.Number, { exact: true }),
})

export const attachmentPartSchema = Schema.Struct({
  type: Schema.Literal('attachment'),
  attachment: preparedAttachmentSchema,
})

export const toolCallPartSchema = Schema.Struct({
  type: Schema.Literal('tool-call'),
  toolCall: toolCallRequestSchema,
})

export const toolResultPartSchema = Schema.Struct({
  type: Schema.Literal('tool-result'),
  toolResult: toolCallResultSchema,
})

/** Message parts, a union discriminated by `type`. */
export const messagePartSchema = Schema.Union(
  textPartSchema,
  attachmentPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  reasoningPartSchema,
)

export const messageRoleSchema = Schema.Literal('user', 'assistant', 'system')

export const compactionSummaryMetadataSchema = Schema.Struct({
  summary: Schema.String,
  tokensBefore: Schema.Number,
  reason: Schema.optionalWith(Schema.Literal('manual', 'threshold', 'overflow'), { exact: true }),
})

export const branchSummaryMetadataSchema = Schema.Struct({ summary: Schema.String })

export const messageMetadataSchema = Schema.Struct({
  /** Authoritative append order in the native Session log, not its visible transcript index. */
  sessionNodeCreatedOrder: Schema.optionalWith(Schema.Number, { exact: true }),
  /** Hash of Pi's transformed user text, used to reconcile steering delivery receipts. */
  durableTextSha256: Schema.optionalWith(Schema.String, { exact: true }),
  visualizationSessionId: Schema.optionalWith(sessionIdSchema, { exact: true }),
  waggle: Schema.optionalWith(waggleMetadataSchema, { exact: true }),
  waggleInvocation: Schema.optionalWith(waggleInvocationMetadataSchema, { exact: true }),
  branchSummary: Schema.optionalWith(branchSummaryMetadataSchema, { exact: true }),
  compactionSummary: Schema.optionalWith(compactionSummaryMetadataSchema, { exact: true }),
  /**
   * The model the Session selected when this response was made. Under a virtual model it differs
   * from `Message.model`, the physical model the router sent the request to.
   */
  selectedModel: Schema.optionalWith(supportedModelIdSchema, { exact: true }),
  /** The provider error this response ended with (Pi's `errorMessage` of a failed response). */
  error: Schema.optionalWith(Schema.String, { exact: true }),
  /** A user message a Scheduled task run delivered, not one a person typed. */
  scheduledTask: Schema.optionalWith(messageScheduledTaskOriginSchema, { exact: true }),
  /**
   * The notice of a Hive wake: the Host started this Run because Worker updates reached an idle
   * parent. Its row holds the Host's notice text, never anything the user wrote.
   */
  hiveWake: Schema.optionalWith(Schema.Literal(true), { exact: true }),
})

export const messageSchema = Schema.Struct({
  id: messageIdSchema,
  role: messageRoleSchema,
  parts: Schema.Array(messagePartSchema),
  model: Schema.optionalWith(supportedModelIdSchema, { exact: true }),
  metadata: Schema.optionalWith(messageMetadataSchema, { exact: true }),
  createdAt: Schema.Number,
})
