import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_EXPORT_PATH_CHECKPOINT_SCHEMA_STATEMENTS,
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
      parent_id TEXT REFERENCES session_nodes(id) ON DELETE CASCADE,
      path_depth INTEGER NOT NULL,
      created_order INTEGER NOT NULL
    );
  `)
}

describe('Session Host export selected-path migration', () => {
  const databases: DatabaseSync[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('keeps the control export schema independent of the Session node projection', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')

    expect(() => applyStatements(database, SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS)).not.toThrow()
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE name = 'session_export_path_checkpoint_build_input'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })

  it('defers sparse path checkpoints instead of blocking migration on a path backfill', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    prepareDependencies(database)
    database.exec(`
      INSERT INTO sessions (id) VALUES ('session-1');
      WITH RECURSIVE sequence(value) AS (
        VALUES(0)
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 1024
      )
      INSERT INTO session_nodes (id, session_id, parent_id, path_depth, created_order)
      SELECT
        'node-' || printf('%04d', value),
        'session-1',
        CASE WHEN value = 0 THEN NULL ELSE 'node-' || printf('%04d', value - 1) END,
        value,
        value
      FROM sequence;
    `)
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
           WHERE type = 'table' AND name LIKE 'session_export_path_%'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: 'session_export_path_checkpoints' },
      { name: 'session_export_path_index_states' },
    ])
    expect(
      database
        .prepare(
          `SELECT path_depth FROM session_export_path_checkpoints
           WHERE session_id = 'session-1' ORDER BY path_depth`,
        )
        .all(),
    ).toEqual([])
    expect(
      database
        .prepare(
          `SELECT topology_revision, indexed_topology_revision
           FROM session_export_path_index_states WHERE session_id = 'session-1'`,
        )
        .get(),
    ).toEqual({ topology_revision: 1, indexed_topology_revision: 0 })
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name = 'session_export_selected_path_nodes'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })

  it('is safe to apply after the fresh target schema already created the tables', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    prepareDependencies(database)
    applyStatements(database, SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS)
    applyStatements(database, SESSION_EXPORT_PATH_CHECKPOINT_SCHEMA_STATEMENTS)

    expect(() =>
      applyStatements(database, SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION.statements),
    ).not.toThrow()
  })
})
