import type { SchemaType } from '@shared/schema'
import type {
  localUpdateRequestSchema,
  localUpdateResponseSchema,
} from '@shared/schemas/local-update'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from './local-session-protocol'

export const LOCAL_UPDATE_CONTRACT_VERSION = 1 as const

export type LocalUpdateRequest = SchemaType<typeof localUpdateRequestSchema>

export type LocalUpdateResponse = SchemaType<typeof localUpdateResponseSchema>

export type LocalUpdateCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'local-update-v1' }
>

export type LocalUpdateCommandResult = Extract<
  LocalSessionCommandResult,
  { readonly contract: 'local-update-v1' }
>
