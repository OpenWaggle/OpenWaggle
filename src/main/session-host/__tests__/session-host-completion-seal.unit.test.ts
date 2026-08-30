import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_CUTOVER_REVISION,
  SESSION_HOST_FRESH_REVISION,
  SESSION_HOST_SCHEMA_REVISION,
} from '../../services/session-host-schema-identity'
import { validateSessionHostCompletionSeal } from '../session-host-completion-seal'

function completionDatabase(input?: {
  readonly revision?: string
  readonly highWatermark?: string
}) {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE session_host_schema_metadata (
      singleton INTEGER PRIMARY KEY, schema_revision INTEGER NOT NULL,
      migration_revision TEXT NOT NULL, source_high_watermark_json TEXT NOT NULL,
      completed_at INTEGER NOT NULL
    );
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );
  `)
  const revision = input?.revision ?? SESSION_HOST_CUTOVER_REVISION
  const highWatermark =
    input?.highWatermark ??
    (revision === SESSION_HOST_FRESH_REVISION
      ? '{}'
      : JSON.stringify({ sessions: 1, nodes: 2, sourceSchemaRevision: 25 }))
  database
    .prepare('INSERT INTO session_host_schema_metadata VALUES (1, ?, ?, ?, ?)')
    .run(SESSION_HOST_SCHEMA_REVISION, revision, highWatermark, 1_000)
  database
    .prepare('INSERT INTO _migrations VALUES (?, ?, ?)')
    .run(SESSION_HOST_BASELINE_MIGRATION_ID, SESSION_HOST_BASELINE_MIGRATION_NAME, 'now')
  return database
}

describe('Session Host completion seal', () => {
  let database: DatabaseSync | undefined

  afterEach(() => {
    database?.close()
    database = undefined
  })

  it.each([SESSION_HOST_CUTOVER_REVISION, SESSION_HOST_FRESH_REVISION])(
    'accepts a complete %s target without reading canonical tables',
    (revision) => {
      const target = completionDatabase({ revision })
      database = target

      expect(() => validateSessionHostCompletionSeal(target)).not.toThrow()
    },
  )

  it.each([
    {
      name: 'missing ledger entry',
      mutate: (target: DatabaseSync) => target.exec('DELETE FROM _migrations'),
    },
    {
      name: 'wrong ledger name',
      mutate: (target: DatabaseSync) =>
        target.exec("UPDATE _migrations SET name = 'unexpected-migration'"),
    },
    {
      name: 'newer migration',
      mutate: (target: DatabaseSync) =>
        target.exec("INSERT INTO _migrations VALUES (27, 'future', 'now')"),
    },
    {
      name: 'unknown completion revision',
      mutate: (target: DatabaseSync) =>
        target.exec("UPDATE session_host_schema_metadata SET migration_revision = 'unknown'"),
    },
    {
      name: 'malformed high-water mark',
      mutate: (target: DatabaseSync) =>
        target.exec(
          'UPDATE session_host_schema_metadata SET source_high_watermark_json = \'{"sessions":1}\'',
        ),
    },
    {
      name: 'incompatible schema revision',
      mutate: (target: DatabaseSync) =>
        target.exec('UPDATE session_host_schema_metadata SET schema_revision = 999'),
    },
  ])('fails closed for a $name', ({ mutate }) => {
    const target = completionDatabase()
    database = target
    mutate(target)

    expect(() => validateSessionHostCompletionSeal(target)).toThrow(
      'completion metadata is missing or incompatible',
    )
  })
})
