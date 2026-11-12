import type { SchemaType } from '@shared/schema'
import type { interactionResponseCommandSchema } from '@shared/schemas/session-control-commands'
import type { interactionResolvedOutcomeSchema } from '@shared/schemas/session-control-outcomes'

export type SessionInteractionResponseCommand = SchemaType<typeof interactionResponseCommandSchema>

export type SessionInteractionResolvedOutcome = SchemaType<typeof interactionResolvedOutcomeSchema>
