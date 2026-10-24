import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { AppMigration } from './database-migrations'
import { HIVE_TOOL_NAME_MIGRATION_ID } from './session-host-schema-identity'

/** The Hive tool's name before ADR 0053, as stored in a Session's tool allowlist. */
const FORMER_HIVE_TOOL_NAME = 'sessions'
const HIVE_TOOL_NAME = 'hive'

/**
 * Rewrites one JSON `tools` array: `sessions` becomes `hive`, each name kept once, in the order
 * it first appeared.
 */
function renamedToolsExpression(column: string) {
  return `(
    SELECT json_group_array(name) FROM (
      SELECT name, MIN(position) AS position FROM (
        SELECT
          CASE WHEN value = '${FORMER_HIVE_TOOL_NAME}' THEN '${HIVE_TOOL_NAME}' ELSE value END AS name,
          CAST(key AS INTEGER) AS position
        FROM json_each(${column}, '$.tools')
      )
      GROUP BY name
      ORDER BY position
    )
  )`
}

function renameStatement(column: string) {
  return `UPDATE session_execution_profiles
    SET ${column} = json_set(${column}, '$.tools', json(${renamedToolsExpression(column)}))
    WHERE ${column} IS NOT NULL
      AND json_valid(${column})
      AND json_type(${column}, '$.tools') = 'array'
      AND EXISTS (
        SELECT 1 FROM json_each(${column}, '$.tools') WHERE value = '${FORMER_HIVE_TOOL_NAME}'
      )`
}

/**
 * ADR 0053 renamed the Hive tool from `sessions` to `hive`, and no old name is accepted. A Session
 * created before the rename from an Agent definition that listed `sessions` stored that name in
 * its Host-authored execution profile (`profile_json.tools`) and Agent-definition snapshot
 * (`resolved_agent_snapshot_json.tools`, which a fork intersects with). Read as they are, such a
 * Session would silently lose the Hive tool. This rewrites those stored allowlists once; it is
 * data the Host wrote, not a name a caller can send, so the old name stays refused everywhere
 * else. A profile without `sessions` is not touched, and running it again changes nothing. The
 * snapshot's `contentDigest` still names the definition file it was taken from.
 */
export const HIVE_TOOL_NAME_MIGRATION_STATEMENTS = [
  renameStatement('profile_json'),
  renameStatement('resolved_agent_snapshot_json'),
] as const

export const HIVE_TOOL_NAME_MIGRATION = {
  id: HIVE_TOOL_NAME_MIGRATION_ID,
  name: 'hive-tool-name',
  statements: [],
  // Some cutover targets from old revisions never gained the profile table.
  run: (sql: SqlClient.SqlClient) =>
    Effect.gen(function* () {
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'session_execution_profiles'
      `
      if (tables.length === 0) return
      for (const statement of HIVE_TOOL_NAME_MIGRATION_STATEMENTS) yield* sql.unsafe(statement)
    }),
} satisfies AppMigration
