import type { SchemaType } from '@shared/schema'
import type { authorizationSetCommandSchema } from '@shared/schemas/session-control-commands'

export type SessionAuthorizationSetCommand = SchemaType<typeof authorizationSetCommandSchema>
