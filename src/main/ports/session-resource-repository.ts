import type { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceCatalogPage,
  SessionResourceCatalogPageRequest,
  SessionResourceCatalogView,
  SessionResourceImageLocation,
  SessionResourceKind,
  SessionResourceNodePageRequest,
  SessionResourceOccurrence,
  SessionResourceRouteSelection,
} from '@shared/types/session-resource'
import { Context, type Effect } from 'effect'
import type { SessionResourceCatalogCursorError, SessionResourceRepositoryError } from '../errors'

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

export interface SessionResourceOccurrenceSelector {
  readonly value: string
  readonly prefix: boolean
}

export interface SessionResourceRepositoryShape {
  readonly upsert: (
    input: UpsertSessionResourceInput,
  ) => Effect.Effect<SessionResource, SessionResourceRepositoryError>
  readonly list: (
    sessionId: SessionId,
  ) => Effect.Effect<readonly SessionResource[], SessionResourceRepositoryError>
  readonly listPage: (
    sessionId: SessionId,
    input: SessionResourceCatalogPageRequest,
  ) => Effect.Effect<
    SessionResourceCatalogPage,
    SessionResourceCatalogCursorError | SessionResourceRepositoryError
  >
  readonly findById: (
    sessionId: SessionId,
    resourceId: string,
    view: SessionResourceCatalogView,
    selection?: SessionResourceRouteSelection | null,
  ) => Effect.Effect<SessionResource | null, SessionResourceRepositoryError>
  readonly findByOccurrence: (
    sessionId: SessionId,
    occurrenceId: string,
    view: SessionResourceCatalogView,
  ) => Effect.Effect<SessionResource | null, SessionResourceRepositoryError>
  readonly findByLocator: (
    sessionId: SessionId,
    kind: SessionResourceKind,
    locator: string,
  ) => Effect.Effect<SessionResource | null, SessionResourceRepositoryError>
  readonly locateImage: (
    sessionId: SessionId,
    resourceId: string,
    selection?: SessionResourceRouteSelection | null,
  ) => Effect.Effect<SessionResourceImageLocation | null, SessionResourceRepositoryError>
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
  readonly hasOccurrences: (
    sessionId: SessionId,
    occurrenceIds: readonly string[],
  ) => Effect.Effect<ReadonlySet<string>, SessionResourceRepositoryError>
  /** Exact backfill slots, including occurrences omitted from bounded UI projections. */
  readonly findByOccurrences: (
    sessionId: SessionId,
    selectors: readonly SessionResourceOccurrenceSelector[],
  ) => Effect.Effect<readonly SessionResource[], SessionResourceRepositoryError>
  readonly listByNodeIds: (
    sessionId: SessionId,
    nodeIds: readonly string[],
    kind: SessionResourceKind | null,
    limit: number,
  ) => Effect.Effect<readonly SessionResource[], SessionResourceRepositoryError>
  readonly listByNodeIdsPage: (
    sessionId: SessionId,
    input: SessionResourceNodePageRequest,
  ) => Effect.Effect<
    SessionResourceCatalogPage,
    SessionResourceCatalogCursorError | SessionResourceRepositoryError
  >
  readonly listManagedNodeIds: (
    sessionId: SessionId,
    limit: number,
  ) => Effect.Effect<readonly string[], SessionResourceRepositoryError>
  readonly getContentLocation: (
    sessionId: SessionId,
    resourceId: string,
  ) => Effect.Effect<SessionResourceContentLocation | null, SessionResourceRepositoryError>
  readonly getBackfillCursor: (
    sessionId: SessionId,
  ) => Effect.Effect<number, SessionResourceRepositoryError>
  readonly advanceBackfillCursor: (
    sessionId: SessionId,
    throughCreatedOrder: number,
  ) => Effect.Effect<void, SessionResourceRepositoryError>
}

export class SessionResourceRepository extends Context.Tag('@openwaggle/SessionResourceRepository')<
  SessionResourceRepository,
  SessionResourceRepositoryShape
>() {}
