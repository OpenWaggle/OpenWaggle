import type { SchemaType } from '@shared/schema'
import type {
  messageMetadataSchema,
  messagePartSchema,
  messageRoleSchema,
  messageSchema,
  textPartSchema,
  toolCallPartSchema,
} from '@shared/schemas/message'
import type { messageScheduledTaskOriginSchema } from '@shared/schemas/message-scheduled-task-origin'
import type {
  attachmentKindSchema,
  attachmentOriginSchema,
  browserPreviewAttachmentSchema,
  preparedAttachmentSchema,
} from '@shared/schemas/validation'
import type { JsonValue } from './json'
import type { WaggleInvocation } from './waggle'

export type MessageRole = SchemaType<typeof messageRoleSchema>

/**
 * Message parts — discriminated union.
 * Use `part.type` to narrow in switch/if statements.
 */
export type TextPart = SchemaType<typeof textPartSchema>

export type AttachmentKind = SchemaType<typeof attachmentKindSchema>
export type AttachmentOrigin = SchemaType<typeof attachmentOriginSchema>

/** The browser preview a picked element or annotation came from, as the attachment schema bounds it. */
export type BrowserPreviewAttachmentMetadata = SchemaType<typeof browserPreviewAttachmentSchema>

export type AttachmentRecord = SchemaType<typeof preparedAttachmentSchema>

export type ToolCallPart = SchemaType<typeof toolCallPartSchema>
export type MessagePart = SchemaType<typeof messagePartSchema>

export interface AttachmentSource {
  readonly source: {
    readonly type: 'data'
    readonly value: string
    readonly mimeType: string
  } | null
}

/** Renderer-safe attachment shape returned by `attachments:prepare` (no binary payload). */
export type PreparedAttachment = AttachmentRecord

/** Main-process runtime attachment shape with hydrated binary source. */
export interface HydratedAttachment extends AttachmentRecord, AttachmentSource {}

export interface HydratedAgentSendPayload extends Omit<AgentSendPayload, 'attachments'> {
  readonly attachments: readonly HydratedAttachment[]
}

export interface AgentSendPayload {
  readonly text: string
  readonly attachments: readonly PreparedAttachment[]
  readonly waggle?: WaggleInvocation
  readonly visualizationContext?: InlineVisualizationContext
}

export type AgentSteerDeliveryResult =
  | {
      readonly delivery: 'queued'
      readonly durableText: string
      readonly minimumCreatedOrder: number
    }
  | {
      readonly delivery: 'handled'
    }

/** Pi acceptance is not durable delivery; queued input is projected as a user node later. */
export type AgentSteerDeliveryReceipt =
  | {
      readonly delivery: 'queued'
      /** Lowercase SHA-256 of Pi's first text block, encoded as UTF-8 without normalization. */
      readonly durableTextSha256: string
      /** First eligible Pi entry index, captured immediately before queuing this steer. */
      readonly minimumCreatedOrder: number
    }
  | {
      readonly delivery: 'handled'
    }

export interface InlineVisualizationContext {
  readonly title: string
  readonly sourcePath: string
  readonly state: JsonValue
}

/**
 * The Scheduled task whose run delivered a user message (ADR 0057). The Host records it with the
 * message when the Run starts, from its own Scheduled task run record, never from the prompt text,
 * so a message cannot claim to be scheduled. It survives the task's later rename or deletion.
 */
export type MessageScheduledTaskOrigin = SchemaType<typeof messageScheduledTaskOriginSchema>

export type MessageMetadata = SchemaType<typeof messageMetadataSchema>
export type Message = SchemaType<typeof messageSchema>

/** Type-safe extraction helper used by getMessageText and IPC handlers. */
export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

/** Used by waggle coordination to detect tool-only assistant turns. */
export function isToolCallPart(part: MessagePart): part is ToolCallPart {
  return part.type === 'tool-call'
}

export function getMessageText(message: Message) {
  return message.parts.reduce((text, part) => (isTextPart(part) ? text + part.text : text), '')
}

/**
 * What became of a send, as reported back to the caller of `agent:send-message`.
 *
 * The invoke used to return nothing, and main recovers every run failure into a value rather than failing the
 * Effect - so a caller awaiting the invoke could not tell a completed turn from a refused one. A review
 * submitted as a session's first message was therefore cleared on a failure that looked exactly like success.
 *
 * More than two outcomes, because "not delivered", "cannot tell" and "kept for later" call for different behaviour:
 *
 * - `delivered`: the run produced a turn.
 * - `refused`: the run never started, and the reason is known. A caller may treat this as an error.
 * - `cancelled`: the run was aborted. This says nothing about whether the message arrived - a cancellation
 *   before the prompt was sent reports the same outcome as one mid-turn - so it must not be raised as an
 *   error, while a caller holding work the user might still want should keep it.
 * - `queued`: the Host kept the message, but as a Follow-up in the Session's queue, not as a Run. It does
 *   this whenever the Session still has a Run or has Follow-ups waiting - including an idle Session whose
 *   queue a failed Run paused. No Run belongs to this send, so a caller must not wait for one: reported
 *   as `delivered`, the renderer showed Stop and "Thinking" over an idle Session indefinitely.
 */
export type AgentSendOutcome = 'delivered' | 'refused' | 'cancelled' | 'queued'

export interface AgentSendReport {
  readonly outcome: AgentSendOutcome
  readonly message?: string
  readonly code?: string
  /** The Run a `delivered` send started, when the Host reported it. */
  readonly runId?: string
}
