import type * as SqlClient from '@effect/sql/SqlClient'
import { OPENWAGGLE_DOCS_TOOL_NAME } from '@shared/constants/openwaggle-docs'
import * as Effect from 'effect/Effect'
import type { AppMigration } from './database-migrations'
import { SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID } from './session-host-schema-identity'

const REQUIRED_TABLES = [
  'session_resources',
  'session_resource_occurrences',
  'session_resource_backfill_state',
] as const

/**
 * An image only an `openwaggle_docs` topic referenced, recorded as an unavailable output.
 *
 * Before #356, backfill read a docs topic's root-relative screenshot path (`/screenshots/…`) as a
 * local file, failed to read it, and recorded "Created by openwaggle_docs" in Outputs > Images
 * with no locator and no managed copy. Live capture never stored one, because it skips an image
 * it cannot read, so every such row is an `unavailable-image:` row whose occurrences all name the
 * docs tool. An image another actor also produced keeps its row.
 */
const DOCS_IMAGE_RESOURCE = `
  resource.kind = 'image'
  AND resource.canonical_key LIKE 'unavailable-image:%'
  AND EXISTS (
    SELECT 1 FROM session_resource_occurrences occurrence
    WHERE occurrence.resource_id = resource.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM session_resource_occurrences occurrence
    WHERE occurrence.resource_id = resource.id
      AND NOT (occurrence.actor = 'tool' AND occurrence.label = '${OPENWAGGLE_DOCS_TOOL_NAME}')
  )`

/**
 * Removes those rows, and backfills their Sessions again so each image comes back as a source the
 * tool read, located at its website URL. Running it again changes nothing.
 */
export const SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_STATEMENTS = [
  `DELETE FROM session_resource_backfill_state
   WHERE session_id IN (
     SELECT resource.session_id FROM session_resources resource WHERE ${DOCS_IMAGE_RESOURCE}
   )`,
  `DELETE FROM session_resources
   WHERE id IN (SELECT resource.id FROM session_resources resource WHERE ${DOCS_IMAGE_RESOURCE})`,
  // Foreign keys cascade on the Host's connection; this covers a connection without them.
  `DELETE FROM session_resource_occurrences
   WHERE label = '${OPENWAGGLE_DOCS_TOOL_NAME}'
     AND NOT EXISTS (
       SELECT 1 FROM session_resources resource
       WHERE resource.id = session_resource_occurrences.resource_id
     )`,
] as const

export const SESSION_RESOURCE_DOCS_IMAGE_MIGRATION = {
  id: SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID,
  name: 'session-resource-docs-image-references',
  statements: [],
  // A cutover target from an old revision may predate the resource catalog.
  run: (sql: SqlClient.SqlClient) =>
    Effect.gen(function* () {
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND ${sql.in('name', REQUIRED_TABLES)}
      `
      if (tables.length < REQUIRED_TABLES.length) return
      for (const statement of SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
    }),
} satisfies AppMigration
