import fs from 'node:fs/promises'
import os from 'node:os'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  insertSession,
  withMigrationDatabase,
} from './database-migrations.test-harness'

let tmpRoot = ''

describe('local Markdown image resource migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(`${os.tmpdir()}/openwaggle-local-image-migration-`)
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('replays only completed sessions with local assistant Markdown images', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 48)
        yield* insertSession(sql, 'local-image')
        yield* insertSession(sql, 'remote-image')
        for (const sessionId of ['local-image', 'remote-image']) {
          yield* sql`INSERT INTO session_resource_backfill_state (session_id, through_created_order)
            VALUES (${sessionId}, 10)`
        }
        yield* sql`INSERT INTO session_nodes (
          id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
          metadata_json, path_depth, created_order
        ) VALUES (
          'local-node', 'local-image', 'message', 'assistant_message', 'assistant', 1,
          ${'{"parts":[{"type":"text","text":"![Evidence](file:///tmp/evidence.png)"}]}'},
          '{}', 0, 0
        ), (
          'remote-node', 'remote-image', 'message', 'assistant_message', 'assistant', 1,
          ${'{"parts":[{"type":"text","text":"![Evidence](https://example.test/evidence.png)"}]}'},
          '{}', 0, 0
        )`
        yield* sql`INSERT INTO session_resources (
          id, session_id, canonical_key, kind, title, created_at, updated_at
        ) VALUES
          ('local-image-resource', 'local-image', 'local-image-key', 'image', 'local.png', 1, 1),
          ('local-link-resource', 'local-image', 'local-link-key', 'link', 'Docs', 1, 1),
          ('remote-image-resource', 'remote-image', 'remote-image-key', 'image', 'remote.png', 1, 1)`
        yield* sql`INSERT INTO session_resource_occurrences (
          id, resource_id, node_id, actor, activity, created_at
        ) VALUES
          ('local-image-occurrence', 'local-image-resource', 'local-node', 'agent', 'created', 1),
          ('local-link-occurrence', 'local-link-resource', 'local-node', 'agent', 'read', 1),
          ('remote-image-occurrence', 'remote-image-resource', 'remote-node', 'agent', 'created', 1)`

        yield* applyMigrations(sql, 59)
        return {
          states: yield* sql<{ readonly session_id: string }>`
            SELECT session_id FROM session_resource_backfill_state ORDER BY session_id
          `,
          occurrences: yield* sql<{ readonly id: string }>`
            SELECT id FROM session_resource_occurrences ORDER BY id
          `,
        }
      }),
    )

    expect(result).toEqual({
      states: [{ session_id: 'remote-image' }],
      occurrences: [{ id: 'local-link-occurrence' }, { id: 'remote-image-occurrence' }],
    })
  })
})
