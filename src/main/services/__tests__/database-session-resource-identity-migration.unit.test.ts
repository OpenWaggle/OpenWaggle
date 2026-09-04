import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFilesystemSessionResourceStoreLayer } from '../../adapters/filesystem-session-resource-store'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { APP_MIGRATIONS } from '../database-migrations'

let tmpRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(tmpRoot, 'resource-identity-migration.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer), Effect.orDie),
  )
}

function applyMigrations(sql: SqlClient.SqlClient, upToId: number) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    for (const migration of APP_MIGRATIONS) {
      if (migration.id > upToId) continue
      const existing = yield* sql<{ id: number }>`
        SELECT id FROM _migrations WHERE id = ${migration.id} LIMIT 1
      `
      if (existing.length > 0) continue
      const skip = migration.skipIfColumn
      if (skip) {
        const columns = yield* sql<{ name: string }>`
          SELECT name FROM pragma_table_info(${skip.table})
        `
        if (columns.some((column) => column.name === skip.column)) {
          yield* sql`
            INSERT INTO _migrations (id, name, applied_at)
            VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
          `
          continue
        }
      }
      if (migration.run) yield* migration.run(sql)
      for (const statement of migration.statements) yield* sql.unsafe(statement)
      yield* sql`
        INSERT INTO _migrations (id, name, applied_at)
        VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
      `
    }
  })
}

describe('session resource identity isolation migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-identity-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('preserves image handles and managed copies while isolating legacy identities', async () => {
    const attachmentPrefix = `session-1:${'same-node-prefix-'.repeat(6)}:provided:attachment:`
    const attachmentOne = `${attachmentPrefix}first:0`
    const attachmentTwo = `${attachmentPrefix}second:1`
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 32)
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES ('session-1', 'pi-session-1', 'Session', 1, 1)
        `
        yield* sql.unsafe(`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator,
            managed_path, available, created_at, updated_at
          ) VALUES
            (
              'legacy-image', 'session-1',
              'url:HTTPS://IMAGES.EXAMPLE.COM:443/architecture.png', 'image', 'Legacy image',
              'image/png', 'HTTPS://IMAGES.EXAMPLE.COM:443/architecture.png',
              '/managed/legacy.png', 1, 1, 1
            ),
            (
              'current-image', 'session-1',
              'image-url:https://images.example.com/architecture.png', 'image', 'Current image',
              NULL, 'https://images.example.com/architecture.png', NULL, 0, 2, 2
            ),
            (
              'lone-legacy-image', 'session-1',
              'url:HTTPS://LONE.EXAMPLE.COM:443/diagram.png', 'image', 'Lone image',
              'image/png', 'HTTPS://LONE.EXAMPLE.COM:443/diagram.png',
              '/managed/lone.png', 1, 1, 1
            ),
            (
              'legacy-distinct-copy', 'session-1',
              'url:https://duplicate.example.com/diagram.png', 'image', 'Legacy duplicate',
              'image/png', 'https://duplicate.example.com/diagram.png',
              '/managed/legacy-duplicate.png', 1, 1, 1
            ),
            (
              'current-distinct-copy', 'session-1',
              'image-url:https://duplicate.example.com/diagram.png', 'image', 'Current duplicate',
              'image/png', 'https://duplicate.example.com/diagram.png',
              '/managed/current-duplicate.png', 1, 2, 2
            ),
            (
              'legacy-attachments', 'session-1', 'file:/input/shared.png', 'file',
              'shared.png', 'image/png', '/input/shared.png', NULL, 0, 1, 1
            )
        `)
        yield* sql.unsafe(`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, actor, activity, created_at
          ) VALUES
            ('legacy-image-occurrence', 'legacy-image', 'node-image-old', 'extension', 'created', 1),
            ('current-image-occurrence', 'current-image', 'node-image-new', 'agent', 'read', 2),
            ('lone-image-occurrence', 'lone-legacy-image', 'node-image-lone', 'agent', 'created', 1)
        `)
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, actor, activity, created_at
          ) VALUES (${attachmentOne}, 'legacy-attachments', 'node-one', 'user', 'provided', 1)
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, actor, activity, created_at
          ) VALUES (${attachmentTwo}, 'legacy-attachments', 'node-two', 'user', 'provided', 2)
        `

        yield* applyMigrations(sql, 33)
        yield* sql.unsafe(`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, locator,
            managed_path, available, created_at, updated_at
          ) VALUES (
            'generic-link', 'session-1',
            'url:https://images.example.com/architecture.png', 'link', 'Generic link',
            'https://images.example.com/architecture.png', NULL, 1, 3, 3
          )
        `)

        const resources = yield* sql<{
          readonly id: string
          readonly canonical_key: string
          readonly kind: string
          readonly mime_type: string | null
          readonly locator: string | null
          readonly managed_path: string | null
          readonly available: number
        }>`
          SELECT id, canonical_key, kind, mime_type, locator, managed_path, available
          FROM session_resources
          WHERE session_id = 'session-1'
          ORDER BY canonical_key
        `
        const occurrences = yield* sql<{
          readonly id: string
          readonly resource_id: string
        }>`
          SELECT id, resource_id
          FROM session_resource_occurrences
          ORDER BY id
        `
        return { resources, occurrences }
      }),
    )

    expect(APP_MIGRATIONS.find(({ id }) => id === 33)?.name).toBe(
      'session-resource-identity-isolation',
    )
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'current-image',
          canonical_key: 'image-url:https://images.example.com/architecture.png',
          mime_type: 'image/png',
          locator: 'https://images.example.com/architecture.png',
          managed_path: '/managed/legacy.png',
          available: 1,
        }),
        expect.objectContaining({
          id: 'generic-link',
          canonical_key: 'url:https://images.example.com/architecture.png',
        }),
        expect.objectContaining({
          id: 'lone-legacy-image',
          canonical_key: 'image-url:https://lone.example.com/diagram.png',
          managed_path: '/managed/lone.png',
          available: 1,
        }),
        expect.objectContaining({
          id: 'legacy-distinct-copy',
          canonical_key: 'legacy-image:legacy-distinct-copy',
          managed_path: '/managed/legacy-duplicate.png',
        }),
        expect.objectContaining({
          id: 'current-distinct-copy',
          canonical_key: 'image-url:https://duplicate.example.com/diagram.png',
          managed_path: '/managed/current-duplicate.png',
        }),
        expect.objectContaining({ canonical_key: `unavailable-attachment:${attachmentOne}` }),
        expect.objectContaining({ canonical_key: `unavailable-attachment:${attachmentTwo}` }),
      ]),
    )
    expect(result.resources.map(({ id }) => id)).not.toContain('legacy-image')
    expect(result.resources.map(({ id }) => id)).not.toContain('legacy-attachments')
    const migratedOne = result.resources.find(
      ({ canonical_key }) => canonical_key === `unavailable-attachment:${attachmentOne}`,
    )
    const migratedTwo = result.resources.find(
      ({ canonical_key }) => canonical_key === `unavailable-attachment:${attachmentTwo}`,
    )
    expect(migratedOne).toBeDefined()
    expect(migratedTwo).toBeDefined()
    expect(migratedOne?.id).not.toBe(migratedTwo?.id)
    expect(Buffer.byteLength(migratedOne?.id ?? '')).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(migratedTwo?.id ?? '')).toBeLessThanOrEqual(64)
    expect(result.occurrences).toEqual(
      expect.arrayContaining([
        { id: 'legacy-image-occurrence', resource_id: 'current-image' },
        { id: 'current-image-occurrence', resource_id: 'current-image' },
        { id: 'lone-image-occurrence', resource_id: 'lone-legacy-image' },
        { id: attachmentOne, resource_id: migratedOne?.id },
        { id: attachmentTwo, resource_id: migratedTwo?.id },
      ]),
    )

    if (!migratedOne || !migratedTwo) throw new Error('Expected split attachment resources.')
    const sourceOne = path.join(tmpRoot, 'attachment-one.png')
    const sourceTwo = path.join(tmpRoot, 'attachment-two.png')
    await fs.writeFile(sourceOne, 'first')
    await fs.writeFile(sourceTwo, 'second')
    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        const first = yield* store.storeFile({
          sessionId: SessionId('session-1'),
          resourceId: migratedOne.id,
          fileName: 'shared.png',
          sourcePath: sourceOne,
          expectedSizeBytes: 5,
          maxSizeBytes: 5,
        })
        const second = yield* store.storeFile({
          sessionId: SessionId('session-1'),
          resourceId: migratedTwo.id,
          fileName: 'shared.png',
          sourcePath: sourceTwo,
          expectedSizeBytes: 6,
          maxSizeBytes: 6,
        })
        return { first, second }
      }).pipe(
        Effect.provide(
          makeFilesystemSessionResourceStoreLayer(path.join(tmpRoot, 'managed-resources')),
        ),
      ),
    )
    expect(stored.first.path).not.toBe(stored.second.path)
    await expect(fs.readFile(stored.first.path, 'utf8')).resolves.toBe('first')
    await expect(fs.readFile(stored.second.path, 'utf8')).resolves.toBe('second')
  })
})
