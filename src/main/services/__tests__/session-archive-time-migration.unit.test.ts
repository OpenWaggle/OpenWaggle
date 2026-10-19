import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SESSION_ARCHIVE_TIME_MIGRATION } from '../session-archive-time-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

function databaseWithSessions() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
    );
    CREATE TABLE session_branches (id TEXT PRIMARY KEY, archived_at INTEGER);
    INSERT INTO sessions VALUES ('archived', 1, 42), ('active', 0, 7);
  `)
  return database
}

describe('session archive time migration', () => {
  it('backfills archived sessions from their last update and leaves active ones unset', () => {
    const database = databaseWithSessions()
    try {
      for (const statement of SESSION_ARCHIVE_TIME_MIGRATION.statements) database.exec(statement)
      const rows = database.prepare('SELECT id, archived_at FROM sessions ORDER BY id').all()
      expect(rows).toEqual([
        { id: 'active', archived_at: null },
        { id: 'archived', archived_at: 42 },
      ])
    } finally {
      database.close()
    }
  })

  it('records the archive time on archive and clears it on restore', () => {
    const database = databaseWithSessions()
    try {
      for (const statement of SESSION_ARCHIVE_TIME_MIGRATION.statements) database.exec(statement)
      database.exec("UPDATE sessions SET archived = 1, updated_at = 100 WHERE id = 'active'")
      database.exec("UPDATE sessions SET updated_at = 200 WHERE id = 'active'")
      database.exec("UPDATE sessions SET archived = 1, updated_at = 300 WHERE id = 'active'")
      database.exec("UPDATE sessions SET archived = 0, updated_at = 400 WHERE id = 'archived'")
      const rows = database.prepare('SELECT id, archived_at FROM sessions ORDER BY id').all()
      expect(rows).toEqual([
        { id: 'active', archived_at: 100 },
        { id: 'archived', archived_at: null },
      ])
    } finally {
      database.close()
    }
  })

  it('indexes only archived sessions', () => {
    const database = databaseWithSessions()
    try {
      for (const statement of SESSION_ARCHIVE_TIME_MIGRATION.statements) database.exec(statement)
      const indexes = database
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE '%archived_at'",
        )
        .all()
      // The branch index is created by the migration's run step, which the store's archived
      // items integration test covers through `INDEXED BY idx_session_branches_archived_at`.
      expect(indexes.map((index) => index.name)).toEqual(['idx_sessions_archived_at'])
      expect(indexes.every((index) => String(index.sql).includes('WHERE'))).toBe(true)
    } finally {
      database.close()
    }
  })

  it('is the newest migration this binary supports', () => {
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_ARCHIVE_TIME_MIGRATION.id)
  })
})
