import type { SchemaType } from '@shared/schema'
import type {
  sessionHandoffWorkspaceSchema,
  sessionOrganizationCommandSchemas,
  sessionOrganizationOutcomeSchemas,
} from '@shared/schemas/session-organization'

export type SessionHandoffWorkspaceSelection = SchemaType<typeof sessionHandoffWorkspaceSchema>

export type SessionOrganizationCommand = SchemaType<
  (typeof sessionOrganizationCommandSchemas)[number]
>

export type SessionOrganizationOutcome = SchemaType<
  (typeof sessionOrganizationOutcomeSchemas)[number]
>
