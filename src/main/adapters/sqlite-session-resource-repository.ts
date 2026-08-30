import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionResourceRepositoryError } from '../errors'
import {
  type RekeySessionResourceInput,
  type SessionResourceContentLocation,
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
  type UpsertSessionResourceInput,
} from '../ports/session-resource-repository'
import {
  advanceSessionResourceBackfillCursor,
  getSessionResourceBackfillCursor,
} from './sqlite-session-resource-backfill-state'
import {
  rowToResource,
  type SessionResourceOccurrenceRow,
  type SessionResourceRow,
} from './sqlite-session-resource-codec'
import { listResources, readResourceById } from './sqlite-session-resource-reader'

function repositoryError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

function upsertResource(sql: SqlClient.SqlClient, input: UpsertSessionResourceInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO session_resources (
            id,
            session_id,
            canonical_key,
            kind,
            title,
            mime_type,
            locator,
            managed_path,
            available,
            created_at,
            updated_at
          ) VALUES (
            ${input.id},
            ${input.sessionId},
            ${input.canonicalKey},
            ${input.kind},
            ${input.title},
            ${input.mimeType},
            ${input.locator},
            ${input.managedPath},
            ${input.available ? 1 : 0},
            ${input.createdAt},
            ${input.updatedAt}
          )
          ON CONFLICT(session_id, canonical_key) DO UPDATE SET
            kind = CASE
              WHEN session_resources.kind = 'image' OR excluded.kind <> 'image'
                THEN session_resources.kind
              ELSE excluded.kind
            END,
            title = CASE
              WHEN excluded.updated_at >= session_resources.updated_at THEN excluded.title
              ELSE session_resources.title
            END,
            mime_type = CASE
              WHEN excluded.kind = 'image' AND excluded.mime_type LIKE 'image/%'
                THEN excluded.mime_type
              ELSE COALESCE(session_resources.mime_type, excluded.mime_type)
            END,
            locator = CASE
              WHEN excluded.id = session_resources.id AND excluded.available = 0
                THEN excluded.locator
              WHEN excluded.managed_path IS NOT NULL THEN excluded.locator
              ELSE COALESCE(session_resources.locator, excluded.locator)
            END,
            managed_path = CASE
              WHEN excluded.id = session_resources.id AND excluded.available = 0 THEN NULL
              ELSE COALESCE(excluded.managed_path, session_resources.managed_path)
            END,
            available = CASE
              WHEN excluded.id = session_resources.id AND excluded.available = 0 THEN 0
              ELSE MAX(excluded.available, session_resources.available)
            END,
            updated_at = MAX(session_resources.updated_at, excluded.updated_at)
        `
        const rows = yield* sql<{ readonly id: string }>`
          SELECT id
          FROM session_resources
          WHERE session_id = ${input.sessionId}
            AND canonical_key = ${input.canonicalKey}
          LIMIT 1
        `
        const resourceId = rows[0]?.id
        if (!resourceId) {
          return yield* Effect.fail(new Error('Upserted session resource could not be read.'))
        }
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id,
            resource_id,
            node_id,
            branch_id,
            actor,
            activity,
            label,
            created_at
          ) VALUES (
            ${input.occurrence.id},
            ${resourceId},
            ${input.occurrence.nodeId},
            ${input.occurrence.branchId},
            ${input.occurrence.actor},
            ${input.occurrence.activity},
            ${input.occurrence.label},
            ${input.occurrence.createdAt}
          )
          ON CONFLICT(id) DO UPDATE SET
            node_id = excluded.node_id,
            branch_id = excluded.branch_id,
            actor = excluded.actor,
            activity = excluded.activity,
            label = excluded.label,
            created_at = excluded.created_at
        `
        const resource = yield* readResourceById(sql, input.sessionId, resourceId)
        if (!resource) {
          return yield* Effect.fail(new Error('Upserted session resource could not be read.'))
        }
        return resource
      }),
    )
    .pipe(Effect.mapError((cause) => repositoryError('upsert', cause)))
}

function rekeyResource(sql: SqlClient.SqlClient, input: RekeySessionResourceInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const sourceRows = yield* sql<{ readonly id: string }>`
          SELECT id
          FROM session_resources
          WHERE session_id = ${input.sessionId}
            AND id = ${input.resourceId}
            AND available = 0
            AND managed_path IS NULL
          LIMIT 1
        `
        if (!sourceRows[0]) {
          return yield* Effect.fail(new Error('Session resource to re-key could not be read.'))
        }
        const targetRows = yield* sql<{ readonly id: string }>`
          SELECT id
          FROM session_resources
          WHERE session_id = ${input.sessionId}
            AND canonical_key = ${input.canonicalKey}
          LIMIT 1
        `
        const targetId = targetRows[0]?.id
        const resolvedId = targetId ?? input.resourceId

        if (targetId && targetId !== input.resourceId) {
          yield* sql`
            UPDATE session_resource_occurrences
            SET resource_id = ${targetId}
            WHERE resource_id = ${input.resourceId}
          `
          yield* sql`
            UPDATE session_resources
            SET updated_at = MAX(updated_at, ${input.updatedAt})
            WHERE session_id = ${input.sessionId}
              AND id = ${targetId}
          `
          yield* sql`
            DELETE FROM session_resources
            WHERE session_id = ${input.sessionId}
              AND id = ${input.resourceId}
          `
        } else {
          yield* sql`
            UPDATE session_resources
            SET canonical_key = ${input.canonicalKey},
                updated_at = MAX(updated_at, ${input.updatedAt})
            WHERE session_id = ${input.sessionId}
              AND id = ${input.resourceId}
          `
        }

        const resource = yield* readResourceById(sql, input.sessionId, resolvedId)
        if (!resource) {
          return yield* Effect.fail(new Error('Re-keyed session resource could not be read.'))
        }
        return resource
      }),
    )
    .pipe(Effect.mapError((cause) => repositoryError('rekey', cause)))
}

function findByCanonicalKey(sql: SqlClient.SqlClient, sessionId: SessionId, canonicalKey: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionResourceRow>`
      SELECT
        id,
        session_id,
        canonical_key,
        kind,
        title,
        mime_type,
        locator,
        managed_path,
        available,
        created_at,
        updated_at
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND canonical_key = ${canonicalKey}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const occurrenceRows = yield* sql<SessionResourceOccurrenceRow>`
      SELECT id, resource_id, node_id, branch_id, actor, activity, label, created_at
      FROM session_resource_occurrences
      WHERE resource_id = ${row.id}
      ORDER BY created_at ASC, id ASC
    `
    return rowToResource(row, occurrenceRows)
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
      findByCanonicalKey: (sessionId, canonicalKey) =>
        findByCanonicalKey(sql, sessionId, canonicalKey),
      rekey: (input) => rekeyResource(sql, input),
      hasOccurrence: (sessionId, occurrenceId) => hasOccurrence(sql, sessionId, occurrenceId),
      getContentLocation: (sessionId, resourceId) => getContentLocation(sql, sessionId, resourceId),
      getBackfillCursor: (sessionId) => getSessionResourceBackfillCursor(sql, sessionId),
      advanceBackfillCursor: (sessionId, throughCreatedOrder) =>
        advanceSessionResourceBackfillCursor(sql, sessionId, throughCreatedOrder),
    } satisfies SessionResourceRepositoryShape)
  }),
)
