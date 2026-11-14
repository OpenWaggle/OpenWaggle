import type { SchemaType } from '@shared/schema'
import type { sessionQueryResponseSchema } from '@shared/schemas/local-session-command-response'

export type SessionQueryResponse = SchemaType<typeof sessionQueryResponseSchema>
