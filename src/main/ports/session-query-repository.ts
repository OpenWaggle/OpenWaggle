import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'
import { Context, type Effect } from 'effect'
import type { SessionQueryRepositoryError } from '../errors'

export interface SessionQueryRepositoryShape {
  readonly execute: (input: {
    readonly callerId?: string
    readonly authority?: LocalSessionProfileAuthority
    readonly request: SessionQueryRequest
  }) => Effect.Effect<SessionQueryResponse, SessionQueryRepositoryError>
}

export class SessionQueryRepository extends Context.Tag('@openwaggle/SessionQueryRepository')<
  SessionQueryRepository,
  SessionQueryRepositoryShape
>() {}
