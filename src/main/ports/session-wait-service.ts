import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'
import { Context, type Effect } from 'effect'

export interface SessionWaitServiceShape {
  readonly wait: (input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
    readonly request: SessionQueryRequest & {
      readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'wait' }>
    }
  }) => Effect.Effect<SessionQueryResponse, Error>
  readonly waitForExport: (input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
    readonly request: SessionQueryRequest & {
      readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'exports-wait' }>
    }
  }) => Effect.Effect<SessionQueryResponse, Error>
}

export class SessionWaitService extends Context.Tag('@openwaggle/SessionWaitService')<
  SessionWaitService,
  SessionWaitServiceShape
>() {}
