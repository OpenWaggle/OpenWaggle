import type { SchemaType } from '@shared/schema'
import type { localHostRequestSchema, localHostResponseSchema } from '@shared/schemas/local-host'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from './local-session-protocol'

export const LOCAL_HOST_CONTRACT_VERSION = 1 as const

/** Ask the Session Host to stop: it accepts no new work and exits once its active work ends. */
export type LocalHostStopRequest = SchemaType<typeof localHostRequestSchema>

export type LocalHostRequest = LocalHostStopRequest

export type LocalHostStopResponse = SchemaType<typeof localHostResponseSchema>

export type LocalHostResponse = LocalHostStopResponse

export type LocalHostCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'local-host-v1' }
>

export type LocalHostCommandResult = Extract<
  LocalSessionCommandResult,
  { readonly contract: 'local-host-v1' }
>
