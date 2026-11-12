import type { SchemaType } from '@shared/schema'
import type {
  interruptCommandSchema,
  interruptDescendantsCommandSchema,
} from '@shared/schemas/session-control-commands'
import type { descendantInterruptionsRequestedOutcomeSchema } from '@shared/schemas/session-control-outcomes'

export type SessionControlInterruptCommand = SchemaType<typeof interruptCommandSchema>

export type SessionControlInterruptDescendantsCommand = SchemaType<
  typeof interruptDescendantsCommandSchema
>

export type SessionControlDescendantInterruptionOutcome = SchemaType<
  typeof descendantInterruptionsRequestedOutcomeSchema
>
