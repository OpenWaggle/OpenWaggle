import { Schema } from '@shared/schema'
import { preparedAttachmentSchema } from './validation'
import { waggleInvocationMetadataSchema } from './waggle'

const logOrderSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

/** A user message's display parts: text and attachment metadata, never Pi model input. */
const userDisplayPartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('attachment'), attachment: preparedAttachmentSchema }),
)

/** `AgentTransportUserMessage`: a user message the Run incorporated, as the transcript shows it. */
export const agentTransportUserMessageSchema = Schema.Struct({
  parts: Schema.Array(userDisplayPartSchema),
  sessionNodeCreatedOrder: logOrderSchema,
  durableTextSha256: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),
  waggleInvocation: Schema.optional(waggleInvocationMetadataSchema),
})

/** `BackgroundRunUserMessage`: an incorporated user message an active Run snapshot retains. */
export const backgroundRunUserMessageSchema = Schema.Struct({
  ...agentTransportUserMessageSchema.fields,
  messageId: Schema.String,
  timestamp: Schema.Number,
  afterAssistantMessageId: Schema.optional(Schema.String),
})
