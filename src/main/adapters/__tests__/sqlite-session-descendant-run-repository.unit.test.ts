import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDescendantRunRepository } from '../../ports/session-descendant-run-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SqliteSessionDescendantRunRepositoryLive } from '../sqlite-session-descendant-run-repository'

describe('SQLite descendant Run repository', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns only active recursive descendants, deepest first', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-descendants-'))
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'host.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const schema = Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY,
            parent_session_id TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_control_states (
            session_id TEXT PRIMARY KEY,
            active_run_id TEXT
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          INSERT INTO session_spawn_lineage VALUES
            ('worker-a', 'queen'),
            ('worker-b', 'queen'),
            ('grandchild', 'worker-a'),
            ('other-worker', 'other-queen')
        `)
        yield* sql.unsafe(`
          INSERT INTO session_control_states VALUES
            ('worker-a', 'run-a'),
            ('worker-b', 'run-b'),
            ('grandchild', 'run-grandchild'),
            ('other-worker', 'run-other')
        `)
        yield* sql.unsafe(`
          INSERT INTO session_runs VALUES
            ('run-a', 'worker-a', 'active'),
            ('run-b', 'worker-b', 'completed'),
            ('run-grandchild', 'grandchild', 'starting'),
            ('run-other', 'other-worker', 'active')
        `)
      }).pipe(Effect.provide(sqlite)),
    )
    const layer = Layer.mergeAll(
      sqlite,
      schema,
      SqliteSessionDescendantRunRepositoryLive.pipe(Layer.provide(sqlite)),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionDescendantRunRepository
        return yield* repository.listActive({ ancestorSessionId: 'queen' })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual([
      { sessionId: 'grandchild', runId: 'run-grandchild', depth: 2 },
      { sessionId: 'worker-a', runId: 'run-a', depth: 1 },
    ])
  })
})
