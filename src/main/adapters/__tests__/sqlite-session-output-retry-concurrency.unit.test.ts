import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordSessionChangeRequest } from '../../application/session-resource-recording'
import { SessionOutputRetryRepository } from '../../ports/session-output-retry-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  CURRENT_SESSION_SCHEMA_STATEMENTS,
} from '../../services/database-schema'
import { SqliteSessionOutputRetryRepositoryLive } from '../sqlite-session-output-retry-repository'
import { SqliteSessionResourceRepositoryLive } from '../sqlite-session-resource-repository'

let tmpRoot = ''

function makeTestLayer(databasePath: string) {
  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schemaLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      for (const statement of [
        ...CURRENT_SESSION_SCHEMA_STATEMENTS,
        ...CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
      ]) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (id, pi_session_id, title, archived, created_at, updated_at)
        VALUES ('session-1', 'pi-session-1', 'Session', 0, 1000, 1000)
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  return Layer.mergeAll(
    schemaLayer,
    SqliteSessionOutputRetryRepositoryLive.pipe(Layer.provide(sqliteLayer)),
    SqliteSessionResourceRepositoryLive.pipe(Layer.provide(sqliteLayer)),
    Layer.succeed(
      SessionRepository,
      SessionRepository.of(
        fromPartial<SessionRepositoryShape>({ getWorkspace: () => Effect.succeed(null) }),
      ),
    ),
    sqliteLayer,
  )
}

describe('SQLite Session Output retry concurrency', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-output-retry-race-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('keeps a refreshed retry when stale cleanup races with the newer payload', async () => {
    const sessionId = SessionId('session-1')
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        const stale = yield* repository.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Original title',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          nodeId: 'original-node',
          branchId: 'original-branch',
          createdAt: 1000,
          updatedAt: 1000,
        })
        if (stale.kind !== 'change-request') {
          return yield* Effect.die('Expected a change-request retry.')
        }
        const refreshed = yield* repository.put({
          ...stale,
          title: 'Updated title',
          nodeId: 'later-node',
          branchId: 'later-branch',
          createdAt: 2000,
          updatedAt: 2000,
        })
        yield* repository.remove(stale)
        const afterStaleCleanup = yield* repository.list(sessionId)
        yield* repository.remove(refreshed)
        return { stale, refreshed, afterStaleCleanup, remaining: yield* repository.list(sessionId) }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'cleanup.sqlite')))),
    )

    expect(result.refreshed).toMatchObject({
      title: 'Updated title',
      nodeId: 'original-node',
      branchId: 'original-branch',
      createdAt: 1000,
      updatedAt: 2000,
    })
    expect(result.afterStaleCleanup).toEqual([result.refreshed])
    expect(result.remaining).toEqual([])
  })

  it('rejects an older payload that reaches the retry queue after newer metadata', async () => {
    const sessionId = SessionId('session-1')
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        const newer = yield* repository.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Updated title',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          nodeId: 'original-node',
          branchId: 'original-branch',
          createdAt: 1000,
          updatedAt: 2000,
        })
        if (newer.kind !== 'change-request') {
          return yield* Effect.die('Expected a change-request retry.')
        }
        const staleArrival = yield* repository.put({
          ...newer,
          title: 'Original title',
          updatedAt: 1000,
        })
        return { newer, staleArrival, pending: yield* repository.list(sessionId) }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'reverse-order.sqlite')))),
    )

    expect(result.staleArrival).toEqual(result.newer)
    expect(result.pending).toEqual([result.newer])
  })

  it('keeps refreshed metadata when an older in-flight retry records after cleanup', async () => {
    const sessionId = SessionId('session-1')
    const url = 'https://github.com/openwaggle/openwaggle/pull/1'
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const retries = yield* SessionOutputRetryRepository
        const resources = yield* SessionResourceRepository
        const stale = yield* retries.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Original title',
          url,
          nodeId: 'original-node',
          branchId: 'original-branch',
          createdAt: 1000,
          updatedAt: 1000,
        })
        if (stale.kind !== 'change-request') {
          return yield* Effect.die('Expected a change-request retry.')
        }
        const refreshed = yield* retries.put({
          ...stale,
          title: 'Updated title',
          nodeId: 'later-node',
          branchId: 'later-branch',
          createdAt: 2000,
          updatedAt: 2000,
        })
        if (refreshed.kind !== 'change-request') {
          return yield* Effect.die('Expected a change-request retry.')
        }

        yield* recordSessionChangeRequest(sessionId, refreshed, refreshed)
        yield* retries.remove(refreshed)
        yield* recordSessionChangeRequest(sessionId, stale, stale)
        yield* retries.remove(stale)
        return {
          pending: yield* retries.list(sessionId),
          resources: yield* resources.list(sessionId),
        }
      }).pipe(Effect.provide(makeTestLayer(path.join(tmpRoot, 'resource.sqlite')))),
    )

    expect(result.pending).toEqual([])
    expect(result.resources).toEqual([
      expect.objectContaining({
        kind: 'change-request',
        title: 'Updated title',
        createdAt: 1000,
        updatedAt: 2000,
        occurrences: [
          expect.objectContaining({
            nodeId: 'original-node',
            branchId: 'original-branch',
            createdAt: 1000,
          }),
        ],
      }),
    ])
  })
})
