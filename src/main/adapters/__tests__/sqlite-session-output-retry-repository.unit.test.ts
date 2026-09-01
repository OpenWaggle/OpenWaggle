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

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        yield* repository.put({
          id: 'pending-commit',
          sessionId: firstSessionId,
          kind: 'commit',
          commitHash: 'abc123',
          summary: 'Persisted commit',
          createdAt: 1000,
        })
        yield* repository.put({
          id: 'pending-change-request',
          sessionId: secondSessionId,
          kind: 'change-request',
          title: 'Persisted PR',
          url: 'https://github.com/openwaggle/openwaggle/pull/1',
          createdAt: 2000,
        })
      }).pipe(Effect.provide(firstLayer)),
    )

    const restartedLayer = makeTestLayer(databasePath)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOutputRetryRepository
        const first = yield* repository.list(firstSessionId)
        const second = yield* repository.list(secondSessionId)
        yield* repository.remove(secondSessionId, 'pending-commit')
        const preserved = yield* repository.list(firstSessionId)
        yield* repository.remove(firstSessionId, 'pending-commit')
        const removed = yield* repository.list(firstSessionId)
        return { first, second, preserved, removed }
      }).pipe(Effect.provide(restartedLayer)),
    )

    expect(result.first).toEqual([
      expect.objectContaining({ kind: 'commit', commitHash: 'abc123' }),
    ])
    expect(result.second).toEqual([
      expect.objectContaining({ kind: 'change-request', title: 'Persisted PR' }),
    ])
    expect(result.preserved).toHaveLength(1)
    expect(result.removed).toEqual([])
  })
})
