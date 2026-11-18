import type { SchemaType } from '@shared/schema'
import type {
  localSessionProfileManagementCommandSchema,
  localSessionProfileManagementOutcomeSchema,
  localSessionProfileManagementRequestSchema,
  localSessionProfileManagementResponseSchema,
  localSessionProfileSummarySchema,
  localSessionProfileUiCommandSchema,
} from '@shared/schemas/local-session-profile-management'

export const LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION = 1 as const

export type LocalSessionProfileSummary = SchemaType<typeof localSessionProfileSummarySchema>
export type LocalSessionProfileManagementCommand = SchemaType<
  typeof localSessionProfileManagementCommandSchema
>
export type LocalSessionProfileManagementRequest = SchemaType<
  typeof localSessionProfileManagementRequestSchema
>
export type LocalSessionProfileManagementOutcome = SchemaType<
  typeof localSessionProfileManagementOutcomeSchema
>
export type LocalSessionProfileManagementResponse = SchemaType<
  typeof localSessionProfileManagementResponseSchema
>
export type LocalSessionProfileUiCommand = SchemaType<typeof localSessionProfileUiCommandSchema>
