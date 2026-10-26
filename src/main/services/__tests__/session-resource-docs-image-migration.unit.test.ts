import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'
import {
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION,
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_STATEMENTS,
} from '../session-resource-docs-image-migration'
import { V1_BETA_MIGRATIONS } from '../v1-beta-migrations'

const SCHEMA = [
  `CREATE TABLE session_resources (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, canonical_key TEXT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, locator TEXT, managed_path TEXT, available INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE session_resource_occurrences (
    id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, actor TEXT NOT NULL, activity TEXT NOT NULL,
    label TEXT, locator TEXT
  )`,
  `CREATE TABLE session_resource_backfill_state (
    session_id TEXT PRIMARY KEY, through_created_order INTEGER NOT NULL
  )`,
]

interface Row {
  readonly session: string
  readonly id: string
  readonly key: string
  readonly kind?: string
  readonly available?: number
  readonly occurrences: readonly { actor: string; activity: string; label: string | null }[]
}

function database(rows: readonly Row[]) {
  const db = new Database(':memory:')
  for (const statement of SCHEMA) db.exec(statement)
  const resource = db.prepare(
    `INSERT INTO session_resources (id, session_id, canonical_key, kind, title, available)
     VALUES (?, ?, ?, ?, 'title', ?)`,
  )
  const occurrence = db.prepare(
    'INSERT INTO session_resource_occurrences VALUES (?, ?, ?, ?, ?, ?)',
  )
  const backfill = db.prepare(
    'INSERT OR IGNORE INTO session_resource_backfill_state VALUES (?, 100)',
  )
  for (const row of rows) {
    resource.run(row.id, row.session, row.key, row.kind ?? 'image', row.available ?? 0)
    row.occurrences.forEach((entry, index) => {
      occurrence.run(
        `${row.id}:${String(index)}`,
        row.id,
        entry.actor,
        entry.activity,
        entry.label,
        '/screenshots/hive-sessions.png',
      )
    })
    backfill.run(row.session)
  }
  return db
}

function migrate(db: Database.Database) {
  for (const statement of SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_STATEMENTS) db.exec(statement)
}

function ids(db: Database.Database, sql: string) {
  return db
    .prepare<[], Record<string, unknown>>(sql)
    .all()
    .map((row) => String(row.id))
}

const DOCS_OUTPUT = { actor: 'tool', activity: 'created', label: 'openwaggle_docs' }

describe('session-resource-docs-image migration', () => {
  it('removes images an openwaggle_docs topic referenced and re-backfills their Sessions', () => {
    const db = database([
      {
        session: 'docs',
        id: 'docs-image',
        key: 'unavailable-image:docs:n:0',
        occurrences: [DOCS_OUTPUT],
      },
      {
        session: 'agent',
        id: 'agent-image',
        key: 'unavailable-image:agent:n:0',
        occurrences: [{ actor: 'agent', activity: 'created', label: null }],
      },
      {
        session: 'mixed',
        id: 'mixed-image',
        key: 'unavailable-image:mixed:n:0',
        occurrences: [DOCS_OUTPUT, { actor: 'agent', activity: 'created', label: null }],
      },
      {
        session: 'captured',
        id: 'captured-image',
        key: 'sha256:abc',
        available: 1,
        occurrences: [DOCS_OUTPUT],
      },
      {
        session: 'docs-tool',
        id: 'docs-tool',
        key: 'tool:openwaggle_docs',
        kind: 'tool',
        available: 1,
        occurrences: [{ actor: 'tool', activity: 'read', label: 'openwaggle_docs' }],
      },
    ])
    try {
      migrate(db)

      expect(ids(db, 'SELECT id FROM session_resources ORDER BY id')).toEqual([
        'agent-image',
        'captured-image',
        'docs-tool',
        'mixed-image',
      ])
      expect(
        ids(db, 'SELECT resource_id AS id FROM session_resource_occurrences ORDER BY id'),
      ).toEqual(['agent-image', 'captured-image', 'docs-tool', 'mixed-image', 'mixed-image'])
      expect(
        ids(db, 'SELECT session_id AS id FROM session_resource_backfill_state ORDER BY session_id'),
      ).toEqual(['agent', 'captured', 'docs-tool', 'mixed'])

      migrate(db)
      expect(ids(db, 'SELECT id FROM session_resources ORDER BY id')).toHaveLength(4)
    } finally {
      db.close()
    }
  })

  it('is the newest beta migration, and one this binary supports', () => {
    expect(V1_BETA_MIGRATIONS.at(-1)).toBe(SESSION_RESOURCE_DOCS_IMAGE_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_RESOURCE_DOCS_IMAGE_MIGRATION.id)
    expect(SESSION_RESOURCE_DOCS_IMAGE_MIGRATION.name).toBe(
      'session-resource-docs-image-references',
    )
  })
})
