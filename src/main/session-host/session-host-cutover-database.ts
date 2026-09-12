import type { DatabaseSync } from 'node:sqlite'

export function cutoverRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

export function queryCutoverRecord(database: DatabaseSync, sql: string, ...parameters: string[]) {
  const value: unknown = database.prepare(sql).get(...parameters)
  return cutoverRecord(value)
}

export function readCutoverCount(database: DatabaseSync, table: string) {
  const count = queryCutoverRecord(database, `SELECT COUNT(*) AS count FROM ${table}`)?.count
  return typeof count === 'number' ? count : 0
}

export function cutoverTableExists(database: DatabaseSync, table: string) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table),
  )
}

export function sourceSchemaRevision(database: DatabaseSync) {
  const revision = queryCutoverRecord(
    database,
    'SELECT MAX(id) AS revision FROM _migrations',
  )?.revision
  return typeof revision === 'number' ? revision : 0
}
