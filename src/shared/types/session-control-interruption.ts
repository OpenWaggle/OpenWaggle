import type { SchemaType } from '@shared/schema'
import type {
  interruptCommandSchema,
  interruptDescendantsCommandSchema,
} from '@shared/schemas/session-control-commands'

export type SessionControlInterruptCommand = SchemaType<typeof interruptCommandSchema>

export type SessionControlInterruptDescendantsCommand = SchemaType<
  typeof interruptDescendantsCommandSchema
>
