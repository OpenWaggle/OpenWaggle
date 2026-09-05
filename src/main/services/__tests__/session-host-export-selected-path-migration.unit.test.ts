import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_EXPORT_SELECTED_PATH_SCHEMA_STATEMENTS,
  SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS,
} from '../session-host-export-schema'
import { SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION } from '../session-host-export-selected-path-migration'

function applyStatements(database: DatabaseSync, statements: readonly string[]) {
  for (const statement of statements) database.exec(statement)
}

function prepareDependencies(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE session_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_order INTEGER NOT NULL
    );
  `)
}

describe('Session Host export selected-path migration', () => {
  const databases: DatabaseSync[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('adds the operation-scoped materialization tables to an existing export schema', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    prepareDependencies(database)
    applyStatements(
      database,
      SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS.slice(
        0,
        -SESSION_EXPORT_SELECTED_PATH_SCHEMA_STATEMENTS.length,
      ),
    )

    applyStatements(database, SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION.statements)

    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name LIKE 'session_export_selected_path%'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: 'session_export_selected_path_nodes' },
      { name: 'session_export_selected_paths' },
    ])
  })

  it('is safe to apply after the fresh target schema already created the tables', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    prepareDependencies(database)
    applyStatements(database, SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS)

    expect(() =>
      applyStatements(database, SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION.statements),
    ).not.toThrow()
  })
})
