import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionOutputRetryRepository } from '../../ports/session-output-retry-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  CURRENT_SESSION_SCHEMA_STATEMENTS,
} from '../../services/database-schema'
import { SqliteSessionOutputRetryRepositoryLive } from '../sqlite-session-output-retry-repository'

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
        INSERT OR IGNORE INTO sessions (
          id, pi_session_id, title, archived, created_at, updated_at
        ) VALUES (
          'session-1', 'pi-session-1', 'Session', 0, 1000, 1000
        ), (
          'session-2', 'pi-session-2', 'Other session', 0, 1000, 1000
        )
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  const repositoryLayer = SqliteSessionOutputRetryRepositoryLive.pipe(Layer.provide(sqliteLayer))
  return Layer.mergeAll(schemaLayer, repositoryLayer, sqliteLayer)
}

describe('SqliteSessionOutputRetryRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-output-retries-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('persists retries across repository instances and scopes deletion to the session', async () => {
    const databasePath = path.join(tmpRoot, 'output-retries.sqlite')
    const firstLayer = makeTestLayer(databasePath)
    const firstSessionId = SessionId('session-1')
    const secondSessionId = SessionId('session-2')
    const pendingCommit = {
      id: 'pending-commit',
      sessionId: firstSessionId,
      kind: 'commit' as const,
      commitHash: 'abc123',
      summary: 'Persisted commit',
      nodeId: 'node-at-commit',
      branchId: 'branch-at-commit',
      createdAt: 1000,
    }
    const pendingChangeRequest = {
      id: 'pending-change-request',
      sessionId: secondSessionId,
      kind: 'change-request' as const,
      title: 'Persisted PR',
      url: 'https://github.com/openwaggle/openwaggle/pull/1',
      nodeId: 'node-at-request',
      branchId: 'branch-at-request',
      createdAt: 2000,
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        yield* repository.put(pendingCommit)
        yield* repository.put(pendingChangeRequest)
      }).pipe(Effect.provide(firstLayer)),
    )

    const restartedLayer = makeTestLayer(databasePath)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        const first = yield* repository.list(firstSessionId)
        const second = yield* repository.list(secondSessionId)
        yield* repository.remove({ ...pendingCommit, sessionId: secondSessionId })
        const preserved = yield* repository.list(firstSessionId)
        yield* repository.remove(pendingCommit)
        const removed = yield* repository.list(firstSessionId)
        return { first, second, preserved, removed }
      }).pipe(Effect.provide(restartedLayer)),
    )

    expect(result.first).toEqual([
      expect.objectContaining({
        kind: 'commit',
        commitHash: 'abc123',
        nodeId: 'node-at-commit',
        branchId: 'branch-at-commit',
      }),
    ])
    expect(result.second).toEqual([
      expect.objectContaining({
        kind: 'change-request',
        title: 'Persisted PR',
        nodeId: 'node-at-request',
        branchId: 'branch-at-request',
      }),
    ])
    expect(result.preserved).toHaveLength(1)
    expect(result.removed).toEqual([])
  })

  it('preserves the original occurrence when an existing retry is refreshed', async () => {
    const databasePath = path.join(tmpRoot, 'output-retry-upsert.sqlite')
    const layer = makeTestLayer(databasePath)
    const sessionId = SessionId('session-1')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        yield* repository.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Original title',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          nodeId: 'original-node',
          branchId: 'original-branch',
          createdAt: 1000,
        })
        yield* repository.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Updated title',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          nodeId: 'later-node',
          branchId: 'later-branch',
          createdAt: 2000,
        })
        return yield* repository.list(sessionId)
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual([
      {
        id: 'pending-change-request',
        sessionId,
        kind: 'change-request',
        title: 'Updated title',
        url: 'https://github.com/openwaggle/openwaggle/pull/1',
        nodeId: 'original-node',
        branchId: 'original-branch',
        createdAt: 1000,
      },
    ])
  })

  it('keeps a refreshed retry when stale cleanup races with the newer payload', async () => {
    const databasePath = path.join(tmpRoot, 'output-retry-stale-cleanup.sqlite')
    const layer = makeTestLayer(databasePath)
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
        })
        const refreshed = yield* repository.put({
          id: 'pending-change-request',
          sessionId,
          kind: 'change-request',
          title: 'Updated title',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          nodeId: 'later-node',
          branchId: 'later-branch',
          createdAt: 2000,
        })
        yield* repository.remove(stale)
        const afterStaleCleanup = yield* repository.list(sessionId)
        yield* repository.remove(refreshed)
        const afterWinningCleanup = yield* repository.list(sessionId)
        return { stale, refreshed, afterStaleCleanup, afterWinningCleanup }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.stale).toMatchObject({
      title: 'Original title',
      nodeId: 'original-node',
      branchId: 'original-branch',
      createdAt: 1000,
    })
    expect(result.refreshed).toMatchObject({
      title: 'Updated title',
      nodeId: 'original-node',
      branchId: 'original-branch',
      createdAt: 1000,
    })
    expect(result.afterStaleCleanup).toEqual([result.refreshed])
    expect(result.afterWinningCleanup).toEqual([])
  })

  it('does not move or retype an existing retry when its id is reused', async () => {
    const databasePath = path.join(tmpRoot, 'output-retry-identity.sqlite')
    const layer = makeTestLayer(databasePath)
    const firstSessionId = SessionId('session-1')
    const secondSessionId = SessionId('session-2')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        yield* repository.put({
          id: 'shared-pending-id',
          sessionId: firstSessionId,
          kind: 'commit',
          commitHash: 'abc123',
          summary: 'Original commit',
          nodeId: 'original-node',
          branchId: 'original-branch',
          createdAt: 1000,
        })
        const crossSession = yield* repository
          .put({
            id: 'shared-pending-id',
            sessionId: secondSessionId,
            kind: 'commit',
            commitHash: 'def456',
            summary: 'Other session',
            nodeId: 'other-node',
            branchId: 'other-branch',
            createdAt: 2000,
          })
          .pipe(Effect.either)
        const crossKind = yield* repository
          .put({
            id: 'shared-pending-id',
            sessionId: firstSessionId,
            kind: 'change-request',
            title: 'Retyped request',
            url: 'https://github.com/openwaggle/openwaggle/pull/2',
            nodeId: 'later-node',
            branchId: 'later-branch',
            createdAt: 3000,
          })
          .pipe(Effect.either)
        return {
          crossSession,
          crossKind,
          first: yield* repository.list(firstSessionId),
          second: yield* repository.list(secondSessionId),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.crossSession).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionOutputRetryRepositoryError', operation: 'put' },
    })
    expect(result.crossKind).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionOutputRetryRepositoryError', operation: 'put' },
    })
    expect(result.first).toEqual([
      {
        id: 'shared-pending-id',
        sessionId: firstSessionId,
        kind: 'commit',
        commitHash: 'abc123',
        summary: 'Original commit',
        nodeId: 'original-node',
        branchId: 'original-branch',
        createdAt: 1000,
      },
    ])
    expect(result.second).toEqual([])
  })
})
