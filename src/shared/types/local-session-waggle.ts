import type { SchemaType } from '@shared/schema'
import type { waggleSendReportSchema } from '@shared/schemas/local-session-command-response'
import type { LocalSessionCommandPayload } from './local-session-protocol'

export const SESSION_WAGGLE_CONTRACT_VERSION = 1 as const

type LocalSessionWaggleContract = 'session-waggle-v1' | 'session-waggle-cancel-v1'

export type LocalSessionWaggleCommandPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: LocalSessionWaggleContract }
>

/** A Waggle send's report; unlike a classic send, a Waggle send is never `queued`. */
export type WaggleSendReport = SchemaType<typeof waggleSendReportSchema>
