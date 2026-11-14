import type { LocalSessionCommandPayload } from './local-session-protocol'

export const LOCAL_UPDATE_CONTRACT_VERSION = 1 as const

export type LocalUpdateCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'local-update-v1' }
>
