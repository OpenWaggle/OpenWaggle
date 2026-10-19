import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

const promote = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-promote',
  idempotencyKey: 'idempotency-promote',
  command: {
    operation: 'promote',
    sessionId: 'session-target',
    expectedRunId: 'run-next',
    followUpId: 'follow-up-next',
  },
} as const

const replace = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-replace',
  idempotencyKey: 'idempotency-replace',
  command: {
    operation: 'replace',
    sessionId: 'session-target',
    expectedRunId: 'run-next',
    input: { text: 'Start over.', attachmentIds: [] },
  },
} as const

describe('SQLite Session Control replacement during a pending promotion', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-promotion-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('refuses a replacement while a promotion waits for delivery, and admits it afterwards', async () => {
    // A replacement waits for the Run to settle while it holds the Session's locks, so a promotion
    // that stepped aside from them could not complete, the Run's settlement failed on the
    // reservation, and the already-steered Follow-up stayed queued for a second delivery.
    const layer = SqliteSessionControlOperationJournalLive.pipe(
      Layer.provideMerge(
        makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'journal.sqlite')),
      ),
    )
    const decideReplace = vi.fn(() => ({ accepted: true }) as const)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const journal = yield* SessionControlOperationJournal
        const promotion = yield* journal.claim({
          callerId: 'local-user',
          request: promote,
          decide: () => ({ accepted: true }),
        })
        const refused = yield* journal.claim({
          callerId: 'local-user',
          request: replace,
          decide: decideReplace,
        })
        yield* journal.complete({
          callerId: 'local-user',
          request: promote,
          outcome: {
            operation: 'promote',
            effect: 'rejected',
            sessionId: 'session-target',
            code: 'run_not_live',
          },
        })
        const admitted = yield* journal.claim({
          callerId: 'local-user',
          request: { ...replace, requestId: 'request-replace-retry', idempotencyKey: 'retry' },
          decide: decideReplace,
        })
        return { promotion, refused, admitted }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.promotion.status).toBe('claimed')
    expect(result.refused).toEqual({
      status: 'completed',
      replayed: false,
      outcome: {
        operation: 'replace',
        effect: 'rejected',
        sessionId: 'session-target',
        code: 'follow_up_reserved',
      },
    })
    expect(result.admitted.status).toBe('claimed')
    expect(decideReplace).toHaveBeenCalledOnce()
  })

  it('refuses an explicit Waggle replacing the Run while a promotion waits for delivery', async () => {
    // Explicit Waggle replaces the active Run through the lifecycle, not a Session Control claim.
    // The promotion into the replaced Run would then find another Run and leave its steered
    // Follow-up queued for a second delivery.
    const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'waggle.sqlite'))
    const intent = {
      text: 'Use Waggle.',
      attachmentIds: [],
      callerId: 'gui:local-user',
      acceptedAt: 2000,
      idempotencyKey: 'waggle-once',
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'promote'}, ${'session-target'}, ${'pending-promotion'},
            ${JSON.stringify(promote.command)}, ${'pending'}, ${null}, ${1}, ${1}
          )
        `
        if (!lifecycle.replaceWithExternal) {
          return yield* Effect.die('external replacement lifecycle unavailable')
        }
        const replacement = {
          sessionId: SessionId('session-target'),
          previousRunId: RunId('run-next'),
          runId: RunId('waggle-run'),
          intent,
        }
        const refused = yield* lifecycle.replaceWithExternal(replacement)
        const kept = yield* sql<{ readonly active_run_id: string | null }>`
          SELECT active_run_id FROM session_control_states WHERE session_id = ${'session-target'}
        `
        yield* sql`
          UPDATE session_operations SET status = ${'completed'}, outcome_json = ${'{}'}
          WHERE idempotency_key = ${'pending-promotion'}
        `
        const admitted = yield* lifecycle.replaceWithExternal(replacement)
        return { refused, keptRunId: kept[0]?.active_run_id, admitted }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.refused).toEqual({ accepted: false, code: 'follow_up_reserved' })
    expect(result.keptRunId).toBe('run-next')
    expect(result.admitted).toMatchObject({ accepted: true })
  })
})
