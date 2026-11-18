import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from './local-session-protocol'

export const LOCAL_HOST_CONTRACT_VERSION = 1 as const

export type LocalHostCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'local-host-v1' }
>

export type LocalHostCommandResult = Extract<
  LocalSessionCommandResult,
  { readonly contract: 'local-host-v1' }
>
