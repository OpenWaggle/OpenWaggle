import type { SchemaType } from '@shared/schema'
import type { interactionResponseCommandSchema } from '@shared/schemas/session-control-commands'

export type SessionInteractionResponseCommand = SchemaType<typeof interactionResponseCommandSchema>
