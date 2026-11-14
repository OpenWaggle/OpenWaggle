import type { SchemaType } from '@shared/schema'
import type {
  followUpCommandSchema,
  followUpInputSchema,
  messageCommandSchema,
  messageInputSchema,
  promoteCommandSchema,
  replaceCommandSchema,
  startCommandSchema,
  steerCommandSchema,
} from '@shared/schemas/session-control-commands'

/** Message content a caller submits: what a Follow-up message carries. */
export type SessionControlFollowUpInput = SchemaType<typeof followUpInputSchema>

/** Input of a command that may start a Run on an idle Session (`message`, `start`). */
export type SessionControlMessageInput = SchemaType<typeof messageInputSchema>

export type SessionControlMessageCommand = SchemaType<typeof messageCommandSchema>

export type SessionControlSteerCommand = SchemaType<typeof steerCommandSchema>

export type SessionControlStartCommand = SchemaType<typeof startCommandSchema>

export type SessionControlFollowUpCommand = SchemaType<typeof followUpCommandSchema>

export type SessionControlReplaceCommand = SchemaType<typeof replaceCommandSchema>

export type SessionControlPromoteCommand = SchemaType<typeof promoteCommandSchema>
