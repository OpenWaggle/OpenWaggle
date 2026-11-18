import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it } from 'vitest'
import { AppDatabase } from '../../services/database-service'
import { runWalCheckpointBackground } from '../sqlite-wal-checkpoint-background'

const PAGES_WRITTEN = 1_500
const PAGE_SIZED_BLOB = 4_000
const CHECKPOINT_INTERVAL_MS = 50
const WAIT_FOR_WORKER_MS = 2_000

let temporaryRoot = ''

afterEach(async () => {
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
})

it('checkpoints the WAL on a worker thread instead of in the committing call', async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-wal-checkpoint-worker-'))
  const filename = path.join(temporaryRoot, 'host.sqlite')
  const layer = Layer.merge(
    SqliteClient.layer({ filename }),
    Layer.succeed(AppDatabase, { path: filename }),
  )

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('PRAGMA journal_mode = WAL')
        yield* sql.unsafe('CREATE TABLE pages (body BLOB NOT NULL)')
        yield* runWalCheckpointBackground({ intervalMs: CHECKPOINT_INTERVAL_MS })
        const blob = new Uint8Array(PAGE_SIZED_BLOB)
        yield* sql.withTransaction(
          Effect.forEach(
            Array.from({ length: PAGES_WRITTEN }),
            () => sql`INSERT INTO pages (body) VALUES (${blob})`,
            { discard: true },
          ),
        )
        // The Host connection no longer checkpoints in the commit above.
        const [setting] = yield* sql<{ readonly wal_autocheckpoint: number }>`
          PRAGMA wal_autocheckpoint
        `
        yield* Effect.sleep(WAIT_FOR_WORKER_MS)
        // The worker checkpointed every frame, so this write starts the WAL over.
        yield* sql`INSERT INTO pages (body) VALUES (${blob})`
        const [afterWorker] = yield* sql<{ readonly log: number }>`
          PRAGMA wal_checkpoint(PASSIVE)
        `
        return { autocheckpoint: setting?.wal_autocheckpoint, walFrames: afterWorker?.log }
      }).pipe(Effect.provide(layer)),
    ),
  )

  expect(result.autocheckpoint).toBe(0)
  expect(result.walFrames).toBeLessThan(10)
})
