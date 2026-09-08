import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SessionResourceRepositoryError } from '../errors'
import type {
  RekeySessionResourceInput,
  UpsertSessionResourceInput,
} from '../ports/session-resource-repository'
import { findResourceById } from './sqlite-session-resource-catalog'

function repositoryError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

function occurrenceRole(activity: UpsertSessionResourceInput['occurrence']['activity']) {
  return {
    isSource: activity === 'provided' || activity === 'read',
    isOutput: activity === 'created' || activity === 'updated',
  }
}

function upsertResourceMetadata(sql: SqlClient.SqlClient, input: UpsertSessionResourceInput) {
  const role = occurrenceRole(input.occurrence.activity)
  return sql`
    INSERT INTO session_resources (
      id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
      available, is_source, is_output, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.sessionId}, ${input.canonicalKey}, ${input.kind}, ${input.title},
      ${input.mimeType}, ${input.locator}, ${input.managedPath}, ${input.available ? 1 : 0},
      ${role.isSource ? 1 : 0}, ${role.isOutput ? 1 : 0}, ${input.createdAt}, ${input.updatedAt}
    )
    ON CONFLICT(session_id, canonical_key) DO UPDATE SET
      kind = CASE
        WHEN session_resources.kind = 'image' OR excluded.kind = 'image' THEN 'image'
        WHEN session_resources.kind = 'change-request'
          OR excluded.kind = 'change-request' THEN 'change-request'
        WHEN session_resources.kind = 'site' OR excluded.kind = 'site' THEN 'site'
        WHEN excluded.id = session_resources.id THEN excluded.kind
        ELSE session_resources.kind
      END,
      title = CASE
        WHEN excluded.kind = 'image' AND session_resources.kind <> 'image'
          THEN excluded.title
        WHEN session_resources.kind = 'image' AND excluded.kind <> 'image'
          THEN session_resources.title
        WHEN excluded.kind = 'change-request'
          AND session_resources.kind NOT IN ('image', 'change-request')
          THEN excluded.title
        WHEN session_resources.kind = 'change-request'
          AND excluded.kind NOT IN ('image', 'change-request')
          THEN session_resources.title
        WHEN excluded.kind = 'site'
          AND session_resources.kind NOT IN ('image', 'change-request', 'site')
          THEN excluded.title
        WHEN session_resources.kind = 'site'
          AND excluded.kind NOT IN ('image', 'change-request', 'site')
          THEN session_resources.title
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
      is_source = MAX(session_resources.is_source, excluded.is_source),
      is_output = MAX(session_resources.is_output, excluded.is_output),
      updated_at = MAX(session_resources.updated_at, excluded.updated_at)
  `
}

export function upsertResource(sql: SqlClient.SqlClient, input: UpsertSessionResourceInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        yield* upsertResourceMetadata(sql, input)
        const rows = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_resources
          WHERE session_id = ${input.sessionId} AND canonical_key = ${input.canonicalKey}
          LIMIT 1
        `
        const resourceId = rows[0]?.id
        if (!resourceId) {
          return yield* Effect.fail(new Error('Upserted session resource could not be read.'))
        }
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
          ) VALUES (
            ${input.occurrence.id}, ${resourceId}, ${input.occurrence.nodeId},
            ${input.occurrence.branchId}, ${input.occurrence.actor}, ${input.occurrence.activity},
            ${input.occurrence.label}, ${input.occurrence.locator ?? null},
            ${input.occurrence.createdAt}
          )
          ON CONFLICT(id) DO NOTHING
        `
        const resource = yield* findResourceById(sql, input.sessionId, resourceId, 'all')
        if (!resource) {
          return yield* Effect.fail(new Error('Upserted session resource could not be read.'))
        }
        return resource
      }),
    )
    .pipe(Effect.mapError((cause) => repositoryError('upsert', cause)))
}

function mergeRekeyTarget(
  sql: SqlClient.SqlClient,
  input: RekeySessionResourceInput,
  targetId: string,
) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_resource_occurrences
      SET resource_id = ${targetId}
      WHERE resource_id = ${input.resourceId}
    `
    yield* sql`
      UPDATE session_resources
      SET updated_at = MAX(updated_at, ${input.updatedAt}),
          is_source = MAX(
            is_source,
            COALESCE((SELECT is_source FROM session_resources WHERE id = ${input.resourceId}), 0)
          ),
          is_output = MAX(
            is_output,
            COALESCE((SELECT is_output FROM session_resources WHERE id = ${input.resourceId}), 0)
          )
      WHERE session_id = ${input.sessionId} AND id = ${targetId}
    `
    yield* sql`
      DELETE FROM session_resources
      WHERE session_id = ${input.sessionId} AND id = ${input.resourceId}
    `
  })
}

export function rekeyResource(sql: SqlClient.SqlClient, input: RekeySessionResourceInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const sourceRows = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_resources
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
          SELECT id FROM session_resources
          WHERE session_id = ${input.sessionId} AND canonical_key = ${input.canonicalKey}
          LIMIT 1
        `
        const targetId = targetRows[0]?.id
        const resolvedId = targetId ?? input.resourceId
        if (targetId && targetId !== input.resourceId) {
          yield* mergeRekeyTarget(sql, input, targetId)
        } else {
          yield* sql`
            UPDATE session_resources
            SET canonical_key = ${input.canonicalKey}, updated_at = MAX(updated_at, ${input.updatedAt})
            WHERE session_id = ${input.sessionId} AND id = ${input.resourceId}
          `
        }
        const resource = yield* findResourceById(sql, input.sessionId, resolvedId, 'all')
        if (!resource) {
          return yield* Effect.fail(new Error('Re-keyed session resource could not be read.'))
        }
        return resource
      }),
    )
    .pipe(Effect.mapError((cause) => repositoryError('rekey', cause)))
}
