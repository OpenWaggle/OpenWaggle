import { Schema, safeDecodeUnknown } from '@shared/schema'
import { SESSION_HOST_BASELINE_MIGRATION_ID } from '../services/session-host-schema-identity'
import type { HostSqliteDatabase } from './host-sqlite-database'

/** A row decoded with its schema, or `undefined` when there is none or it does not match. */
export function decodeCutoverRow<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  const result: A | undefined = decoded.success ? decoded.data : undefined
  return result
}

export function queryCutoverRow<A, I>(
  database: HostSqliteDatabase,
  schema: Schema.Schema<A, I>,
  sql: string,
  ...parameters: string[]
) {
  const value: unknown = database.prepare(sql).get(...parameters)
  return decodeCutoverRow(schema, value)
}

const countRowSchema = Schema.Struct({ count: Schema.Number })

/** The `count` column of a `SELECT COUNT(*) AS count ...` query. */
export function queryCutoverCount(
  database: HostSqliteDatabase,
  sql: string,
  ...parameters: string[]
) {
  return queryCutoverRow(database, countRowSchema, sql, ...parameters)?.count
}

export function readCutoverCount(database: HostSqliteDatabase, table: string) {
  return queryCutoverCount(database, `SELECT COUNT(*) AS count FROM ${table}`) ?? 0
}

export function cutoverTableExists(database: HostSqliteDatabase, table: string) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table),
  )
}

const revisionRowSchema = Schema.Struct({ revision: Schema.Number })

export function sourceSchemaRevision(database: HostSqliteDatabase) {
  return (
    queryCutoverRow(database, revisionRowSchema, 'SELECT MAX(id) AS revision FROM _migrations')
      ?.revision ?? 0
  )
}

/**
 * Drop pre-cutover ledger rows at Host-baseline-or-later ids.
 *
 * A legacy database predates the Host split, so its released ledger stops below the Host baseline
 * id. Rows at or above it can only come from unreleased builds that numbered Host migrations into
 * the legacy database; left in place they collide with the Host identities the cutover records and
 * abort first launch with a UNIQUE constraint failure.
 */
export function normalizeLegacyMigrationLedger(database: HostSqliteDatabase) {
  if (!cutoverTableExists(database, '_migrations')) return
  database.prepare('DELETE FROM _migrations WHERE id >= ?').run(SESSION_HOST_BASELINE_MIGRATION_ID)
}
