import type { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceKind,
  SessionResourceOccurrence,
} from '@shared/types/session-resource'
import { Context, type Effect } from 'effect'
import type { SessionResourceRepositoryError } from '../errors'

export interface UpsertSessionResourceInput {
  readonly id: string
  readonly sessionId: SessionId
  readonly canonicalKey: string
  readonly kind: SessionResourceKind
  readonly title: string
  readonly mimeType: string | null
  readonly locator: string | null
  readonly managedPath: string | null
  readonly available: boolean
  readonly occurrence: SessionResourceOccurrence
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionResourceContentLocation {
  readonly resourceId: string
  readonly sessionId: SessionId
  readonly fileName: string
  readonly mimeType: string
  readonly managedPath: string
}

export interface RekeySessionResourceInput {
  readonly sessionId: SessionId
  readonly resourceId: string
  readonly canonicalKey: string
  readonly updatedAt: number
}

export interface SessionResourceRepositoryShape {
  readonly upsert: (
    input: UpsertSessionResourceInput,
  ) => Effect.Effect<SessionResource, SessionResourceRepositoryError>
  readonly list: (
    sessionId: SessionId,
  ) => Effect.Effect<readonly SessionResource[], SessionResourceRepositoryError>
  readonly findByCanonicalKey: (
    sessionId: SessionId,
    canonicalKey: string,
  ) => Effect.Effect<SessionResource | null, SessionResourceRepositoryError>
  /** Re-key an unavailable placeholder; matching digest rows absorb its occurrences. */
  readonly rekey: (
    input: RekeySessionResourceInput,
  ) => Effect.Effect<SessionResource, SessionResourceRepositoryError>
  readonly hasOccurrence: (
    sessionId: SessionId,
    occurrenceId: string,
  ) => Effect.Effect<boolean, SessionResourceRepositoryError>
  readonly getContentLocation: (
    sessionId: SessionId,
    resourceId: string,
  ) => Effect.Effect<SessionResourceContentLocation | null, SessionResourceRepositoryError>
}

export class SessionResourceRepository extends Context.Tag('@openwaggle/SessionResourceRepository')<
  SessionResourceRepository,
  SessionResourceRepositoryShape
>() {}
