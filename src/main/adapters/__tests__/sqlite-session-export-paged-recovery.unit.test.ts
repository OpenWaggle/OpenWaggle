import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SESSION_EXPORT_RECOVERY_PAGE_SIZE } from '../sqlite-session-export-recovery'
import { makeSessionExportOperationRuntime } from './sqlite-session-export-operation-test-layer'

describe('bounded SQLite export recovery', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionExportOperationRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-pages-'))
    runtime = makeSessionExportOperationRuntime(path.join(temporaryRoot, 'exports.sqlite'))
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function seedOperations(count: number) {
    return Effect.gen(function* () {
      const repository = yield* SessionExportOperationRepository
      const ids: string[] = []
      for (let index = 0; index < count; index += 1) {
        const created = yield* repository.create({
          callerId: 'local-user',
          idempotencyKey: `export-${index}`,
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, `export-${index}.jsonl`),
          },
          now: index,
        })
        ids.push(created.operation.exportOperationId)
      }
      return ids
    })
  }

  it('fences both claim paths and repeats an unacknowledged page across multiple bounded batches', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionExportOperationRepository
        const sql = yield* SqlClient.SqlClient
        const ids = yield* seedOperations(SESSION_EXPORT_RECOVERY_PAGE_SIZE * 2 + 1)
        const firstId = ids[0]
        const lastId = ids.at(-1)
        if (!firstId || !lastId) return yield* Effect.die('missing seeded exports')
        yield* sql`UPDATE session_export_operations SET status = ${'running'}`
        yield* repository.beginRecovery

        expect((yield* repository.read('session-1', lastId))?.status).toBe('running')
        expect((yield* repository.claimExecution(lastId, 100)).status).toBe('not-claimable')
        expect((yield* repository.claimNextExecution(100)).status).toBe('not-claimable')

        const firstPage = yield* repository.recoverAfterHostLoss(101)
        expect(firstPage).toHaveLength(SESSION_EXPORT_RECOVERY_PAGE_SIZE)
        expect(firstPage.every((operation) => operation.status === 'queued')).toBe(true)
        expect((yield* repository.read('session-1', lastId))?.status).toBe('running')
        expect((yield* repository.claimExecution(firstId, 102)).status).toBe('not-claimable')
        expect(yield* repository.recoverAfterHostLoss(103)).toEqual(firstPage)
        yield* repository.completeRecoveryPage
        expect(yield* repository.recoveryPending).toBe(true)

        const secondPage = yield* repository.recoverAfterHostLoss(104)
        expect(secondPage).toHaveLength(SESSION_EXPORT_RECOVERY_PAGE_SIZE)
        expect(secondPage[0]?.exportOperationId).toBe(ids[SESSION_EXPORT_RECOVERY_PAGE_SIZE])
        yield* repository.completeRecoveryPage
        expect(yield* repository.recoveryPending).toBe(true)

        const lastPage = yield* repository.recoverAfterHostLoss(105)
        expect(lastPage.map((operation) => operation.exportOperationId)).toEqual([lastId])
        yield* repository.completeRecoveryPage
        expect(yield* repository.recoveryPending).toBe(false)
        expect((yield* repository.claimExecution(firstId, 106)).status).toBe('claimed')
      }),
    )
  })

  it('bounds terminal-history scanning and retains cancelled cleanup beyond the first page', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionExportOperationRepository
        const sql = yield* SqlClient.SqlClient
        const ids = yield* seedOperations(SESSION_EXPORT_RECOVERY_PAGE_SIZE + 1)
        const lastId = ids.at(-1)
        if (!lastId) return yield* Effect.die('missing last export')
        yield* sql`
        UPDATE session_export_operations SET status = ${'completed'}, completed_at = ${100}
        WHERE id <> ${lastId}
      `
        yield* repository.beginRecovery
        yield* repository.requestCancellation({
          sessionId: 'session-1',
          exportOperationId: lastId,
          now: 101,
        })

        expect(yield* repository.recoverAfterHostLoss(102)).toEqual([])
        yield* repository.completeRecoveryPage
        expect(yield* repository.recoveryPending).toBe(true)
        const page = yield* repository.recoverAfterHostLoss(103)
        expect(page).toHaveLength(1)
        expect(page[0]).toMatchObject({
          exportOperationId: lastId,
          status: 'cancelled',
          cleanupPending: true,
        })

        // An interrupted host creates a new snapshot and finds the durable cleanup receipt again.
        yield* repository.beginRecovery
        yield* repository.recoverAfterHostLoss(104)
        yield* repository.completeRecoveryPage
        expect((yield* repository.recoverAfterHostLoss(105))[0]?.cleanupPending).toBe(true)
        yield* repository.completeCleanup(lastId, 106)
        yield* repository.completeRecoveryPage
        expect(yield* repository.recoveryPending).toBe(false)
        expect((yield* repository.read('session-1', lastId))?.cleanupPending).toBe(false)
      }),
    )
  })

  it('does not include newly admitted exports in the startup snapshot', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionExportOperationRepository
        const [existingId] = yield* seedOperations(1)
        yield* repository.beginRecovery
        const created = yield* repository.create({
          callerId: 'local-user',
          idempotencyKey: 'new-export',
          now: 10,
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, 'new.jsonl'),
          },
        })
        expect(
          (yield* repository.claimExecution(created.operation.exportOperationId, 11)).status,
        ).toBe('not-claimable')
        expect(
          (yield* repository.recoverAfterHostLoss(12)).map(
            (operation) => operation.exportOperationId,
          ),
        ).toEqual([existingId])
        yield* repository.completeRecoveryPage
        expect(
          (yield* repository.claimExecution(created.operation.exportOperationId, 13)).status,
        ).toBe('claimed')
      }),
    )
  })
})
