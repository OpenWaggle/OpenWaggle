import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { makeSessionResourceCatalogTestLayer as makeTestLayer } from './sqlite-session-resource-pagination.test-harness'

let tmpRoot = ''

describe('SqliteSessionResourceRepositoryLive bounded catalog', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-page-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('keyset-pages an exact role total with bounded occurrence previews', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const first = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 20,
        })
        const second = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 20,
          cursor: first.nextCursor,
        })
        return { first, second }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'catalog.sqlite')))),
    )

    expect(result.first.total).toBe(200)
    expect(result.first.resources).toHaveLength(20)
    expect(result.first.resources.every((resource) => resource.isSource)).toBe(true)
    expect(result.first.resources.every((resource) => resource.occurrences.length <= 8)).toBe(true)
    expect(result.first.nextCursor).not.toBeNull()
    expect(new Set(result.first.resources.map(({ id }) => id))).not.toContain(
      result.second.resources[0]?.id,
    )
    expect(result.second.resources).toHaveLength(20)
  })

  it('keeps image ordering stable across pages and reports its branch revision', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const first = yield* repository.listPage(SessionId('session-1'), {
          view: 'images',
          limit: 10,
        })
        const second = yield* repository.listPage(SessionId('session-1'), {
          view: 'images',
          limit: 10,
          cursor: first.nextCursor,
        })
        return { first, second }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'gallery.sqlite')))),
    )

    expect(result.first.total).toBe(150)
    expect(result.first.orderRevision).toMatch(/^branch-active:none:\d+$/u)
    expect(result.first.resources.map(({ id }) => id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `resource-${String(index * 4)}`),
    )
    expect(result.second.resources[0]?.id).toBe('resource-40')
  })

  it('orders ancestor and active-leaf images ahead of a hidden branch and locates neighbors', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionResourceRepository
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES
            (
              'ancestor-node', 'session-1', NULL, 'message', 'message', 'assistant', 1,
              '{}', '{}', 'branch-root', 0, 1
            ),
            (
              'active-leaf-node', 'session-1', 'ancestor-node', 'message', 'message',
              'assistant', 2, '{}', '{}', 'branch-active', 1, 2
            ),
            (
              'hidden-leaf-node', 'session-1', 'ancestor-node', 'message', 'message',
              'assistant', 3, '{}', '{}', 'branch-hidden', 1, 3
            )
        `
        yield* sql`
          UPDATE sessions
          SET last_active_node_id = 'active-leaf-node'
          WHERE id = 'session-1'
        `
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
            available, is_source, is_output, created_at, updated_at
          ) VALUES
            (
              'ancestor-image', 'session-1', 'file:/ancestor.png', 'image', 'Ancestor',
              'image/png', '/ancestor.png', NULL, 1, 1, 0, 30, 30
            ),
            (
              'active-leaf-image', 'session-1', 'file:/active-leaf.png', 'image', 'Active leaf',
              'image/png', NULL, NULL, 1, 1, 0, 20, 20
            ),
            (
              'hidden-leaf-image', 'session-1', 'file:/hidden-leaf.png', 'image', 'Hidden leaf',
              'image/png', '/hidden-leaf.png', NULL, 1, 1, 0, 10, 10
            )
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
          ) VALUES
            (
              'ancestor-image-occurrence', 'ancestor-image', 'ancestor-node', 'branch-root',
              'agent', 'read', NULL, '/ancestor.png', 10
            ),
            (
              'active-leaf-image-occurrence', 'active-leaf-image', 'active-leaf-node',
              'branch-active', 'agent', 'read', NULL, NULL, 20
            ),
            (
              'hidden-leaf-image-occurrence', 'hidden-leaf-image', 'hidden-leaf-node',
              'branch-hidden', 'agent', 'read', NULL, '/hidden-leaf.png', 1
            )
        `
        const page = yield* repository.listPage(SessionId('session-1'), {
          view: 'images',
          limit: 3,
        })
        const location = yield* repository.locateImage(SessionId('session-1'), 'active-leaf-image')
        return { location, page }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'active-path-gallery.sqlite')))),
    )

    expect(result.page.resources.map(({ id }) => id)).toEqual([
      'ancestor-image',
      'active-leaf-image',
      'hidden-leaf-image',
    ])
    expect(result.page.orderRevision).toMatch(/^branch-active:active-leaf-node:\d+$/u)
    expect(result.location).toMatchObject({
      resource: { id: 'active-leaf-image' },
      previous: { id: 'ancestor-image' },
      next: { id: 'hidden-leaf-image' },
      index: 1,
      total: 153,
    })
  })

  it('rejects a continuation cursor after the session catalog mutates', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const sql = yield* SqlClient.SqlClient
        const first = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 10,
        })
        yield* sql`
          UPDATE session_resources
          SET title = 'Mutated resource', updated_at = 999999
          WHERE id = 'resource-200'
        `
        const continuationRejected = yield* repository
          .listPage(SessionId('session-1'), {
            view: 'sources',
            limit: 10,
            cursor: first.nextCursor,
          })
          .pipe(
            Effect.as(false),
            Effect.catchAll(() => Effect.succeed(true)),
          )
        const refreshed = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 10,
        })
        return { first, continuationRejected, refreshed }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'catalog-mutation.sqlite')))),
    )

    expect(result.continuationRejected).toBe(true)
    expect(result.refreshed.orderRevision).not.toBe(result.first.orderRevision)
    expect(result.refreshed.resources[0]?.title).toBe('Mutated resource')
  })

  it('finds Session-owned change requests beyond the first 50 unrelated outputs', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
            available, is_source, is_output, created_at, updated_at
          ) VALUES
            (
              'owned-change-request', 'session-1', 'url:https://github.example/pull/42',
              'change-request', 'Owned pull request', NULL, 'https://github.example/pull/42',
              NULL, 1, 0, 1, 2, 2
            ),
            (
              'other-change-request', 'session-2', 'url:https://github.example/pull/99',
              'change-request', 'Other pull request', NULL, 'https://github.example/pull/99',
              NULL, 1, 0, 1, 3, 3
            ),
            (
              'source-change-request', 'session-1', 'url:https://github.example/pull/7',
              'change-request', 'Read pull request', NULL, 'https://github.example/pull/7',
              NULL, 1, 1, 0, 4, 4
            )
        `
        const genericOutputs = yield* repository.listPage(SessionId('session-1'), {
          view: 'outputs',
          limit: 50,
        })
        const changeRequests = yield* repository.listPage(SessionId('session-1'), {
          view: 'change-requests',
          limit: 10,
        })
        const owned = yield* repository.findById(
          SessionId('session-1'),
          'owned-change-request',
          'change-requests',
        )
        const crossSession = yield* repository.findById(
          SessionId('session-1'),
          'other-change-request',
          'change-requests',
        )
        const queryPlan = yield* sql.unsafe<{ readonly detail: string }>(`
          EXPLAIN QUERY PLAN
          SELECT id
          FROM session_resources
          WHERE session_id = 'session-1'
            AND kind = 'change-request'
            AND is_output = 1
          ORDER BY updated_at DESC, id ASC
          LIMIT 10
        `)
        return { changeRequests, crossSession, genericOutputs, owned, queryPlan }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'change-requests.sqlite')))),
    )

    expect(result.genericOutputs.resources).toHaveLength(50)
    expect(result.genericOutputs.resources.map(({ id }) => id)).not.toContain(
      'owned-change-request',
    )
    expect(result.changeRequests).toMatchObject({
      total: 1,
      nextCursor: null,
      resources: [{ id: 'owned-change-request', sessionId: 'session-1' }],
    })
    expect(result.owned?.id).toBe('owned-change-request')
    expect(result.crossSession).toBeNull()
    expect(result.changeRequests.resources.map(({ id }) => id)).not.toContain(
      'source-change-request',
    )
    expect(
      result.queryPlan.some(({ detail }) =>
        detail.includes('idx_session_resources_change_request_updated'),
      ),
    ).toBe(true)
    expect(result.queryPlan.some(({ detail }) => detail.includes('USE TEMP B-TREE'))).toBe(false)
  })
})
