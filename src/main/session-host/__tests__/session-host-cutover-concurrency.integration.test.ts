import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

const CONCURRENT_SESSION_WRITER = `
  const { DatabaseSync } = require('node:sqlite')
  const { parentPort, workerData } = require('node:worker_threads')
  const database = new DatabaseSync(workerData.databasePath)
  database.exec('PRAGMA busy_timeout = 1000')
  const columns = database.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name)
  const quoted = (value) => '"' + value.replaceAll('"', '""') + '"'
  const select = columns.map((column) => {
    if (column === 'id' || column === 'pi_session_id') return '?'
    if (column === 'title') return '?'
    return quoted(column)
  })
  const cloneSession = database.prepare(
    'INSERT INTO sessions (' + columns.map(quoted).join(', ') + ') SELECT ' +
      select.join(', ') + ' FROM sessions LIMIT 1'
  )
  const binding = database.prepare(
    'SELECT workspace_id, bound_at FROM session_workspace_bindings LIMIT 1'
  ).get()
  const bindWorkspace = database.prepare(
    'INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at) VALUES (?, ?, ?)'
  )
  let inserted = 0
  parentPort.postMessage({ kind: 'ready' })
  for (let index = 0; index < 150; index += 1) {
    const id = 'concurrent-session-' + index
    try {
      database.exec('BEGIN IMMEDIATE')
      cloneSession.run(id, 'pi-' + id, 'Concurrent ' + index)
      bindWorkspace.run(id, binding.workspace_id, binding.bound_at)
      database.exec('COMMIT')
      inserted += 1
    } catch (error) {
      try { database.exec('ROLLBACK') } catch {}
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
  }
  database.close()
  parentPort.postMessage({ kind: 'done', inserted })
`

function waitForWorkerMessage<T>(worker: Worker, kind: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: T & { readonly kind?: string }) => {
      if (message.kind !== kind) return
      cleanup()
      resolve(message)
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
  })
}

describe('Session Host cutover validation concurrency', () => {
  let temporaryRoot = ''
  const workers: Worker[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-concurrency-'))
  })

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('validates one canonical read snapshot while another process commits Sessions', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    const paths = { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath }
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(paths, 1_000, fakeEmbeddingModel)

    const journal = new DatabaseSync(targetDatabasePath)
    try {
      journal.exec('PRAGMA journal_mode = WAL')
    } finally {
      journal.close()
    }

    const worker = new Worker(CONCURRENT_SESSION_WRITER, {
      eval: true,
      workerData: { databasePath: targetDatabasePath },
    })
    workers.push(worker)
    await waitForWorkerMessage(worker, 'ready')
    const finished = waitForWorkerMessage<{ readonly kind: 'done'; readonly inserted: number }>(
      worker,
      'done',
    )

    for (let index = 0; index < 30; index += 1) {
      await expect(
        runSessionHostCutover(paths, 2_000 + index, fakeEmbeddingModel),
      ).resolves.toEqual({
        status: 'already-complete',
        targetDatabasePath,
      })
    }

    expect((await finished).inserted).toBeGreaterThan(0)
  }, 30_000)
})
