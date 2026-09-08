import fs from 'node:fs/promises'
import os from 'node:os'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import {
  applyMigrations,
  type ColumnInfo,
  insertSession,
  withMigrationDatabase,
} from './database-migrations.test-harness'

let tmpRoot = ''

describe('session resource catalog migrations', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(`${os.tmpdir()}/openwaggle-resource-migrations-`)
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('adds a nullable original locator to resource occurrences at migration 36', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 35)
        const existingColumns = yield* sql<ColumnInfo>`
          PRAGMA table_info(session_resource_occurrences)
        `
        if (existingColumns.some((column) => column.name === 'locator')) {
          yield* sql.unsafe(`ALTER TABLE session_resource_occurrences DROP COLUMN locator`)
        }

        yield* applyMigrations(sql, 36)
        const columns = yield* sql<ColumnInfo>`
          PRAGMA table_info(session_resource_occurrences)
        `
        yield* applyMigrations(sql, 36)
        const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
          SELECT id, name FROM _migrations WHERE id = 36
        `
        return { columns, ledger }
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 36)?.name).toBe(
      'session-resource-occurrence-locator',
    )
    expect(result.columns.find((column) => column.name === 'locator')).toMatchObject({ notnull: 0 })
    expect(result.ledger).toEqual([{ id: 36, name: 'session-resource-occurrence-locator' }])
  })

  it('materializes occurrence-derived resource roles and bounded catalog indexes', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 36)
        yield* insertSession(sql, 'resource-role-session')
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
            available, created_at, updated_at
          ) VALUES (
            'resource-role', 'resource-role-session', 'file:/resource-role', 'file',
            'resource-role', NULL, '/resource-role', NULL, 1, 1, 2
          )
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
          ) VALUES
            ('source-occurrence', 'resource-role', 'source-node', NULL, 'user', 'provided',
             NULL, '/source/resource-role', 1),
            ('output-occurrence', 'resource-role', 'output-node', NULL, 'agent', 'updated',
             NULL, '/output/resource-role', 2)
        `
        yield* applyMigrations(sql, 41)
        const roles = yield* sql<{ readonly is_source: number; readonly is_output: number }>`
          SELECT is_source, is_output FROM session_resources WHERE id = 'resource-role'
        `
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'index'
            AND name IN (
              'idx_session_resources_source_updated',
              'idx_session_resources_output_updated',
              'idx_session_resources_image_created',
              'idx_session_resource_occurrences_node_resource',
              'idx_session_resource_occurrences_resource_branch_created'
            )
          ORDER BY name
        `
        return { roles, indexes }
      }),
    )

    expect(result.roles).toEqual([{ is_source: 1, is_output: 1 }])
    expect(result.indexes.map(({ name }) => name)).toEqual([
      'idx_session_resource_occurrences_node_resource',
      'idx_session_resource_occurrences_resource_branch_created',
      'idx_session_resources_image_created',
      'idx_session_resources_output_updated',
      'idx_session_resources_source_updated',
    ])
  })

  it('adds a monotonic session-owned catalog revision at migration 42', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 41)
        for (const trigger of [
          'trg_session_resource_catalog_resource_insert',
          'trg_session_resource_catalog_resource_update',
          'trg_session_resource_catalog_resource_delete',
          'trg_session_resource_catalog_occurrence_insert',
          'trg_session_resource_catalog_occurrence_update',
          'trg_session_resource_catalog_occurrence_delete',
        ]) {
          yield* sql.unsafe(`DROP TRIGGER IF EXISTS ${trigger}`)
        }
        yield* sql.unsafe('DROP TABLE IF EXISTS session_resource_catalog_state')
        yield* applyMigrations(sql, 42)
        yield* insertSession(sql, 'catalog-revision-session')
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, available,
            is_source, is_output, created_at, updated_at
          ) VALUES (
            'revision-resource', 'catalog-revision-session', 'file:/revision-resource',
            'file', 'Revision resource', 1, 1, 0, 1, 1
          )
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, actor, activity, created_at
          ) VALUES ('revision-occurrence', 'revision-resource', 'user', 'provided', 1)
        `
        yield* sql`UPDATE session_resource_occurrences SET label = 'updated' WHERE id = 'revision-occurrence'`
        yield* sql`UPDATE session_resources SET title = 'Updated' WHERE id = 'revision-resource'`
        const revision = yield* sql<{ readonly revision: number }>`
          SELECT revision FROM session_resource_catalog_state
          WHERE session_id = 'catalog-revision-session'
        `
        yield* sql`DELETE FROM sessions WHERE id = 'catalog-revision-session'`
        const afterDelete = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_resource_catalog_state
        `
        return { revision, afterDelete }
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 42)?.name).toBe(
      'session-resource-catalog-revision',
    )
    expect(result.revision).toEqual([{ revision: 4 }])
    expect(result.afterDelete).toEqual([])
  })

  it('adds the indexed change-request catalog view at migration 43', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 43)
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_session_resources_change_request_updated'
        `
        const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
          SELECT id, name FROM _migrations WHERE id = 43
        `
        return { indexes, ledger }
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 43)?.name).toBe(
      'session-resource-change-request-catalog-index',
    )
    expect(result.indexes).toEqual([{ name: 'idx_session_resources_change_request_updated' }])
    expect(result.ledger).toEqual([
      { id: 43, name: 'session-resource-change-request-catalog-index' },
    ])
  })
})
