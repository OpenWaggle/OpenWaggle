import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../services/database-service'
import {
  runWalCheckpointBackground,
  SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES,
  type WalCheckpointWorkerPort,
} from '../sqlite-wal-checkpoint-background'

class FakeWorker extends EventEmitter implements WalCheckpointWorkerPort {
  readonly posted: string[] = []
  /** What the worker sends once it is created. */
  constructor(private readonly firstMessage: unknown) {
    super()
  }
  start() {
    setTimeout(() => this.emit('message', this.firstMessage), 0)
    return this
  }
  terminated = false
  postMessage(message: 'close') {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
    return Promise.resolve(0)
  }
}

let temporaryRoot = ''

afterEach(async () => {
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

async function databaseLayer() {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-wal-checkpoint-'))
  const filename = path.join(temporaryRoot, 'host.sqlite')
  return Layer.merge(
    SqliteClient.layer({ filename }),
    Layer.succeed(AppDatabase, { path: filename }),
  )
}

function autocheckpoint() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ readonly wal_autocheckpoint: number }>`PRAGMA wal_autocheckpoint`
    return row?.wal_autocheckpoint
  })
}

/** Runs the background start in a scope the test closes, and reports the setting meanwhile. */
function withBackground<A>(
  worker: FakeWorker,
  during: (scope: Scope.CloseableScope) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* runWalCheckpointBackground({ factory: () => worker.start() }).pipe(Scope.extend(scope))
    return yield* during(scope)
  })
}

describe('WAL checkpoint background', () => {
  it('stops the Host connection checkpointing once the worker is ready', async () => {
    const worker = new FakeWorker({ type: 'ready', pages: 0 })
    const layer = await databaseLayer()

    const result = await Effect.runPromise(
      withBackground(worker, (scope) =>
        Effect.gen(function* () {
          const whileRunning = yield* autocheckpoint()
          yield* Scope.close(scope, Exit.void)
          return { whileRunning, afterStop: yield* autocheckpoint() }
        }),
      ).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      whileRunning: 0,
      afterStop: SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES,
    })
    expect(worker.posted).toEqual(['close'])
    expect(worker.terminated).toBe(true)
  })

  it('keeps checkpointing on commit when the worker cannot start', async () => {
    const worker = new FakeWorker({ type: 'failed', error: 'no native module' })
    const layer = await databaseLayer()

    const setting = await Effect.runPromise(
      withBackground(worker, () => autocheckpoint()).pipe(Effect.provide(layer)),
    )

    expect(setting).toBe(SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES)
    expect(worker.terminated).toBe(true)
  })

  it('checkpoints on commit again when the worker stops later', async () => {
    const worker = new FakeWorker({ type: 'ready', pages: 0 })
    const layer = await databaseLayer()

    const setting = await Effect.runPromise(
      withBackground(worker, () =>
        Effect.gen(function* () {
          worker.emit('exit', 1)
          yield* Effect.sleep('20 millis')
          return yield* autocheckpoint()
        }),
      ).pipe(Effect.provide(layer)),
    )

    expect(setting).toBe(SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES)
  })

  it('keeps checkpointing on commit, and lets the Host start, when the worker cannot be created', async () => {
    const layer = await databaseLayer()

    const setting = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        yield* runWalCheckpointBackground({
          factory: () => {
            throw new Error("Cannot find module 'better-sqlite3'")
          },
        }).pipe(Scope.extend(scope))
        return yield* autocheckpoint()
      }).pipe(Effect.provide(layer)),
    )

    expect(setting).toBe(SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES)
  })
})
