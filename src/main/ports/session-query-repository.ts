import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'
import { Context, type Effect } from 'effect'
import type { SessionQueryRepositoryError } from '../errors'

export interface SessionQueryRepositoryShape {
  readonly execute: (input: {
    readonly callerId?: string
    readonly authority?: LocalSessionProfileAuthority
    /** Internal durable-export identity; never accepted from the Session query protocol. */
    readonly exportMaterializationOperationId?: string
    /**
     * The Host's parked requests by Session. When given, every Session summary and Delegation
     * with a Delegation state carries `nextActor` (ADR 0059); agent-facing reads pass it.
     */
    readonly pendingRequests?: ReadonlyMap<string, HivePendingRequest>
    readonly request: SessionQueryRequest
  }) => Effect.Effect<SessionQueryResponse, SessionQueryRepositoryError>
}

export class SessionQueryRepository extends Context.Tag('@openwaggle/SessionQueryRepository')<
  SessionQueryRepository,
  SessionQueryRepositoryShape
>() {}
