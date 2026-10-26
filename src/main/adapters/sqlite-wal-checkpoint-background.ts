import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import * as SqlClient from '@effect/sql/SqlClient'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { AppDatabase } from '../services/database-service'

const logger = createLogger('sqlite-wal-checkpoint')

/** SQLite's default: the connection checkpoints itself once the WAL holds this many pages. */
export const SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES = 1_000
export const WAL_CHECKPOINT_INTERVAL_MS = 1_000
const WAL_CHECKPOINT_READY_TIMEOUT_MS = 10_000

/*
 * The worker opens its own connection with the same better-sqlite3 build as the Host, so both
 * connections share one SQLite library and its file locks. Two SQLite copies in one process would
 * not see each other's POSIX locks. A PASSIVE checkpoint never waits for the writer.
 */
const CHECKPOINT_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const Database = require(workerData.betterSqlitePath)
let database
let timer
function checkpoint() {
  const [result] = database.pragma('wal_checkpoint(PASSIVE)')
  return result
}
try {
  database = new Database(workerData.databasePath, { fileMustExist: true })
  const result = checkpoint()
  parentPort.postMessage({ type: 'ready', pages: result ? result.checkpointed : 0 })
  timer = setInterval(() => {
    try {
      checkpoint()
    } catch (error) {
      clearInterval(timer)
      parentPort.postMessage({ type: 'failed', error: String(error && error.message || error) })
    }
  }, workerData.intervalMs)
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: String(error && error.message || error) })
}
parentPort.on('message', (message) => {
  if (message !== 'close') return
  clearInterval(timer)
  try { if (database) database.close() } finally { parentPort.close() }
})
`

const CheckpointWorkerMessage = Schema.Union(
  Schema.Struct({ type: Schema.Literal('ready'), pages: Schema.Number }),
  Schema.Struct({ type: Schema.Literal('failed'), error: Schema.String }),
)
type CheckpointWorkerMessage = typeof CheckpointWorkerMessage.Type

export interface WalCheckpointWorkerPort {
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  postMessage(message: 'close'): void
  terminate(): Promise<number>
}

export type WalCheckpointWorkerFactory = (input: {
  readonly databasePath: string
  readonly intervalMs: number
}) => WalCheckpointWorkerPort

const createCheckpointWorker: WalCheckpointWorkerFactory = (input) =>
  new Worker(CHECKPOINT_WORKER_SOURCE, {
    eval: true,
    workerData: {
      ...input,
      betterSqlitePath: createRequire(__filename).resolve('better-sqlite3'),
    },
  })

function decodeMessage(value: unknown): CheckpointWorkerMessage {
  const decoded = safeDecodeUnknown(CheckpointWorkerMessage, value)
  return decoded.success
    ? decoded.data
    : { type: 'failed', error: 'The WAL checkpoint worker sent an unknown message.' }
}

function setAutocheckpoint(sql: SqlClient.SqlClient, pages: number) {
  return sql.unsafe(`PRAGMA wal_autocheckpoint = ${String(pages)}`).pipe(Effect.asVoid)
}

/**
 * Starts the worker and resolves once its first checkpoint succeeded, or with the reason it could
 * not start. Later failures are reported through `onFailure`, at most once.
 */
function startWorker(input: {
  readonly factory: WalCheckpointWorkerFactory
  readonly databasePath: string
  readonly intervalMs: number
  readonly onFailure: (reason: string) => void
}) {
  return Effect.async<WalCheckpointWorkerPort, Error>((resume) => {
    let worker: WalCheckpointWorkerPort
    try {
      worker = input.factory({ databasePath: input.databasePath, intervalMs: input.intervalMs })
    } catch (error) {
      // Resolving better-sqlite3 or creating the thread can throw before the worker exists.
      resume(Effect.fail(new Error(`The WAL checkpoint worker could not start: ${String(error)}`)))
      return
    }
    let ready = false
    let failed = false
    const fail = (reason: string) => {
      if (failed) return
      failed = true
      if (ready) {
        input.onFailure(reason)
        return
      }
      void worker.terminate()
      resume(Effect.fail(new Error(reason)))
    }
    const deadline = setTimeout(
      () => fail('The WAL checkpoint worker did not start in time.'),
      WAL_CHECKPOINT_READY_TIMEOUT_MS,
    )
    worker.on('message', (value) => {
      const message = decodeMessage(value)
      if (message.type === 'failed') {
        clearTimeout(deadline)
        fail(message.error)
        return
      }
      if (ready) return
      ready = true
      clearTimeout(deadline)
      resume(Effect.succeed(worker))
    })
    worker.on('error', (error) => {
      clearTimeout(deadline)
      fail(error.message)
    })
    worker.on('exit', (code) => {
      clearTimeout(deadline)
      fail(`The WAL checkpoint worker exited with code ${String(code)}.`)
    })
    return Effect.sync(() => {
      clearTimeout(deadline)
      failed = true
      void worker.terminate()
    })
  })
}

/**
 * Host-owned: moves SQLite's WAL checkpoints off the Host's event loop (#357).
 *
 * better-sqlite3 runs on the main thread, and SQLite checkpoints inside the commit that grows the
 * WAL past 1,000 pages. On a 2 GB database that commit took 200 to 500 ms, most often the large
 * snapshot commit at Run settlement. The Host's connection stops checkpointing itself, and a
 * worker thread with its own connection runs a PASSIVE checkpoint every second. If the worker
 * cannot start, or stops later, the connection checkpoints itself again, as before. It never fails.
 */
export function runWalCheckpointBackground(
  options: { readonly factory?: WalCheckpointWorkerFactory; readonly intervalMs?: number } = {},
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { path: databasePath } = yield* AppDatabase
    if (databasePath === ':memory:') return
    let stopping = false
    const restoreAutocheckpoint = (reason: string) => {
      if (stopping) return
      logger.warn('WAL checkpoint worker stopped; the Host checkpoints on commit again', {
        reason,
      })
      Effect.runFork(
        setAutocheckpoint(sql, SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES).pipe(Effect.ignore),
      )
    }
    const started = yield* Effect.either(
      Effect.acquireRelease(
        startWorker({
          factory: options.factory ?? createCheckpointWorker,
          databasePath,
          intervalMs: options.intervalMs ?? WAL_CHECKPOINT_INTERVAL_MS,
          onFailure: restoreAutocheckpoint,
        }),
        (worker) =>
          Effect.gen(function* () {
            stopping = true
            yield* setAutocheckpoint(sql, SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES).pipe(
              Effect.ignore,
            )
            worker.postMessage('close')
            yield* Effect.promise(() => worker.terminate())
          }),
      ),
    )
    if (started._tag === 'Left') {
      logger.warn('WAL checkpoints stay on the Host thread', { reason: started.left.message })
      return
    }
    yield* setAutocheckpoint(sql, 0)
    logger.info('WAL checkpoints run on a worker thread')
  }).pipe(
    // The first Host service: nothing here may keep the Host from starting.
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('WAL checkpoints stay on the Host thread', { cause: Cause.pretty(cause) })
      }),
    ),
  )
}
