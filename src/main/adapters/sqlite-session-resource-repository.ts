import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionResourceCatalogCursorError, SessionResourceRepositoryError } from '../errors'
import {
  type SessionResourceContentLocation,
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import {
  advanceSessionResourceBackfillCursor,
  getSessionResourceBackfillCursor,
} from './sqlite-session-resource-backfill-state'
import {
  findExistingOccurrences,
  findResourceById,
  findResourceByLocator,
  findResourceByOccurrence,
  listManagedResourceNodeIds,
  listResourcePage,
  listResourcesByNodeIds,
  listResourcesByNodeIdsPage,
  locateSessionImage,
} from './sqlite-session-resource-catalog'
import { listResources } from './sqlite-session-resource-reader'
import { rekeyResource, upsertResource } from './sqlite-session-resource-writer'

function repositoryError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

function listPageError(cause: unknown) {
  return cause instanceof SessionResourceCatalogCursorError
    ? cause
    : repositoryError('listPage', cause)
}

function findByCanonicalKey(sql: SqlClient.SqlClient, sessionId: SessionId, canonicalKey: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_resources
      WHERE session_id = ${sessionId}
        AND canonical_key = ${canonicalKey}
      LIMIT 1
    `
    const resourceId = rows[0]?.id
    return resourceId ? yield* findResourceById(sql, sessionId, resourceId, 'all') : null
  }).pipe(Effect.mapError((cause) => repositoryError('findByCanonicalKey', cause)))
}

function getContentLocation(sql: SqlClient.SqlClient, sessionId: SessionId, resourceId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly id: string
      readonly session_id: string
      readonly title: string
      readonly mime_type: string | null
      readonly managed_path: string | null
    }>`
      SELECT id, session_id, title, mime_type, managed_path
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND id = ${resourceId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.managed_path || !row.mime_type) return null
    return {
      resourceId: row.id,
      sessionId: SessionId(row.session_id),
      fileName: row.title,
      mimeType: row.mime_type,
      managedPath: row.managed_path,
    } satisfies SessionResourceContentLocation
  }).pipe(Effect.mapError((cause) => repositoryError('getContentLocation', cause)))
}

function hasOccurrence(sql: SqlClient.SqlClient, sessionId: SessionId, occurrenceId: string) {
  return sql<{ readonly present: number }>`
    SELECT 1 AS present
    FROM session_resource_occurrences occurrence
    INNER JOIN session_resources resource ON resource.id = occurrence.resource_id
    WHERE resource.session_id = ${sessionId}
      AND occurrence.id = ${occurrenceId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.mapError((cause) => repositoryError('hasOccurrence', cause)),
  )
}

export const SqliteSessionResourceRepositoryLive = Layer.effect(
  SessionResourceRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return SessionResourceRepository.of({
      upsert: (input) => upsertResource(sql, input),
      list: (sessionId) => listResources(sql, sessionId),
      listPage: (sessionId, input) =>
        sql
          .withTransaction(listResourcePage(sql, sessionId, input))
          .pipe(Effect.mapError(listPageError)),
      findById: (sessionId, resourceId, view, selection) =>
        findResourceById(sql, sessionId, resourceId, view, selection).pipe(
          Effect.mapError((cause) => repositoryError('findById', cause)),
        ),
      findByOccurrence: (sessionId, occurrenceId, view) =>
        findResourceByOccurrence(sql, sessionId, occurrenceId, view).pipe(
          Effect.mapError((cause) => repositoryError('findByOccurrence', cause)),
        ),
      findByLocator: (sessionId, kind, locator) =>
        findResourceByLocator(sql, sessionId, kind, locator).pipe(
          Effect.mapError((cause) => repositoryError('findByLocator', cause)),
        ),
      locateImage: (sessionId, resourceId, selection) =>
        sql
          .withTransaction(locateSessionImage(sql, sessionId, resourceId, selection))
          .pipe(Effect.mapError((cause) => repositoryError('locateImage', cause))),
      findByCanonicalKey: (sessionId, canonicalKey) =>
        findByCanonicalKey(sql, sessionId, canonicalKey),
      rekey: (input) => rekeyResource(sql, input),
      hasOccurrence: (sessionId, occurrenceId) => hasOccurrence(sql, sessionId, occurrenceId),
      hasOccurrences: (sessionId, occurrenceIds) =>
        findExistingOccurrences(sql, sessionId, occurrenceIds).pipe(
          Effect.mapError((cause) => repositoryError('hasOccurrences', cause)),
        ),
      listByNodeIds: (sessionId, nodeIds, kind, limit) =>
        sql
          .withTransaction(listResourcesByNodeIds(sql, sessionId, nodeIds, kind, limit))
          .pipe(Effect.mapError((cause) => repositoryError('listByNodeIds', cause))),
      listByNodeIdsPage: (sessionId, input) =>
        sql
          .withTransaction(listResourcesByNodeIdsPage(sql, sessionId, input))
          .pipe(Effect.mapError(listPageError)),
      listManagedNodeIds: (sessionId, limit) =>
        listManagedResourceNodeIds(sql, sessionId, limit).pipe(
          Effect.mapError((cause) => repositoryError('listManagedNodeIds', cause)),
        ),
      getContentLocation: (sessionId, resourceId) => getContentLocation(sql, sessionId, resourceId),
      getBackfillCursor: (sessionId) => getSessionResourceBackfillCursor(sql, sessionId),
      advanceBackfillCursor: (sessionId, throughCreatedOrder) =>
        advanceSessionResourceBackfillCursor(sql, sessionId, throughCreatedOrder),
    } satisfies SessionResourceRepositoryShape)
  }),
)
