import type { SchemaType } from '@shared/schema'
import type { authorizationSetCommandSchema } from '@shared/schemas/session-control-commands'
import type { authorizationUpdatedOutcomeSchema } from '@shared/schemas/session-control-outcomes'

export type SessionAuthorizationSetCommand = SchemaType<typeof authorizationSetCommandSchema>

export type SessionAuthorizationUpdatedOutcome = SchemaType<
  typeof authorizationUpdatedOutcomeSchema
>
