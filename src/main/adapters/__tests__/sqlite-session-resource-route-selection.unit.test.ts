import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { makeSessionResourceCatalogTestLayer } from './sqlite-session-resource-pagination.test-harness'

let tmpRoot = ''

function seedBranchGallery(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO session_nodes (
        id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
        content_json, metadata_json, branch_hint_id, path_depth, created_order
      ) VALUES
        (
          'route-root', 'session-1', NULL, 'message', 'message', 'assistant', 1,
          '{}', '{}', 'branch-root', 0, 501
        ),
        (
          'route-active-leaf', 'session-1', 'route-root', 'message', 'message',
          'assistant', 2, '{}', '{}', 'branch-active', 1, 502
        ),
        (
          'route-hidden-leaf', 'session-1', 'route-root', 'message', 'message',
          'assistant', 3, '{}', '{}', 'branch-hidden', 1, 503
        )
    `
    yield* sql`
      INSERT INTO session_branches (
        id, session_id, source_node_id, head_node_id, name, is_main, created_at, updated_at
      ) VALUES
        (
          'branch-active', 'session-1', 'route-root', 'route-active-leaf',
          'Active', 1, 1, 1
        ),
        (
          'branch-hidden', 'session-1', 'route-root', 'route-hidden-leaf',
          'Hidden', 0, 1, 1
        )
    `
    yield* sql`
      UPDATE sessions SET last_active_node_id = 'route-active-leaf' WHERE id = 'session-1'
    `
    yield* sql`
      INSERT INTO session_resources (
        id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
        available, is_source, is_output, created_at, updated_at
      ) VALUES
        (
          'route-root-image', 'session-1', 'file:/route-root.png', 'image', 'Route root',
          'image/png', '/route-root.png', NULL, 1, 1, 0, 30, 30
        ),
        (
          'route-active-image', 'session-1', 'file:/route-active.png', 'image', 'Route active',
          'image/png', '/route-active.png', NULL, 1, 1, 0, 20, 20
        ),
        (
          'route-hidden-image', 'session-1', 'file:/route-hidden.png', 'image', 'Route hidden',
          'image/png', '/route-hidden.png', NULL, 1, 1, 0, 10, 10
        )
    `
    yield* sql`
      INSERT INTO session_resource_occurrences (
        id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
      ) VALUES
        (
          'route-root-occurrence', 'route-root-image', 'route-root', 'branch-active',
          'agent', 'read', NULL, '/route-root.png', 10
        ),
        (
          'route-active-occurrence', 'route-active-image', 'route-active-leaf',
          'branch-active', 'agent', 'read', NULL, '/route-active.png', 20
        ),
        (
          'route-hidden-occurrence', 'route-hidden-image', 'route-hidden-leaf',
          'branch-hidden', 'agent', 'read', NULL, '/route-hidden.png', 1
        )
    `
  })
}

describe('SqliteSessionResourceRepositoryLive route selection', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-route-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('orders and locates images for the displayed inactive branch path', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionResourceRepository
        yield* seedBranchGallery(sql)
        const selection = {
          branchId: 'branch-hidden',
          pathNodeIds: ['route-hidden-leaf'],
        }
        const page = yield* repository.listPage(SessionId('session-1'), {
          view: 'images',
          limit: 3,
          selection,
        })
        const location = yield* repository.locateImage(
          SessionId('session-1'),
          'route-hidden-image',
          selection,
        )
        const mismatchedRouteCursorRejected = yield* repository
          .listPage(SessionId('session-1'), {
            view: 'images',
            limit: 3,
            cursor: page.nextCursor,
            selection: {
              branchId: 'branch-active',
              pathNodeIds: ['route-root', 'route-active-leaf'],
            },
          })
          .pipe(
            Effect.as(false),
            Effect.catchAll(() => Effect.succeed(true)),
          )
        return { location, mismatchedRouteCursorRejected, page }
      }).pipe(
        Effect.provide(
          makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'inactive-gallery.sqlite')),
        ),
      ),
    )

    expect(result.page.resources.map(({ id }) => id)).toEqual([
      'route-hidden-image',
      'route-root-image',
      'route-active-image',
    ])
    expect(result.page.orderRevision).toMatch(/^branch-hidden:path:[a-zA-Z0-9_-]+:\d+$/u)
    expect(result.mismatchedRouteCursorRejected).toBe(true)
    expect(result.location).toMatchObject({
      resource: { id: 'route-hidden-image' },
      previous: null,
      next: { id: 'route-root-image' },
      index: 0,
      total: 153,
      orderRevision: result.page.orderRevision,
    })
  })

  it('ignores route branch and node identities owned by another Session', async () => {
    const page = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionResourceRepository
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            'foreign-route-node', 'session-2', NULL, 'message', 'message', 'assistant', 1,
            '{}', '{}', 'foreign-route-branch', 0, 1
          )
        `
        yield* sql`
          INSERT INTO session_branches (
            id, session_id, source_node_id, head_node_id, name, is_main, created_at, updated_at
          ) VALUES (
            'foreign-route-branch', 'session-2', NULL, 'foreign-route-node',
            'Foreign', 1, 1, 1
          )
        `
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
            available, is_source, is_output, created_at, updated_at
          ) VALUES (
            'foreign-route-image', 'session-1', 'file:/foreign-route.png', 'image',
            'Foreign route', 'image/png', '/foreign-route.png', NULL, 1, 1, 0, 9999, 9999
          )
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
          ) VALUES (
            'foreign-route-occurrence', 'foreign-route-image', 'foreign-route-node',
            'foreign-route-branch', 'agent', 'read', NULL, '/foreign-route.png', 1
          )
        `
        return yield* repository.listPage(SessionId('session-1'), {
          view: 'images',
          limit: 1,
          selection: {
            branchId: 'foreign-route-branch',
            pathNodeIds: ['foreign-route-node'],
          },
        })
      }).pipe(
        Effect.provide(
          makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'foreign-gallery.sqlite')),
        ),
      ),
    )

    expect(page.orderRevision).toMatch(/^none:path:/u)
    expect(page.resources[0]?.id).not.toBe('foreign-route-image')
  })
})
