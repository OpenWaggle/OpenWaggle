import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
  startWorkerRun,
} from './sqlite-session-control-run-lifecycle-test-layer'

/**
 * A client that stops a Worker Run causes that Run's end: its update names the client, so a
 * client that may only interrupt a Worker cannot wake the Worker's parent through it.
 */
function interruptWorkerRunAs(file: string, callerId: string) {
  const layer = SqliteSessionControlOperationJournalLive.pipe(
    Layer.provideMerge(makeSessionControlRunLifecycleTestLayer(file)),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* prepareWorkerDelegation(sql)
      const started = yield* startWorkerRun
      if (started.outcome.effect !== 'started-run') throw new Error(started.outcome.effect)
      const runId = RunId(started.outcome.runId)
      const lifecycle = yield* SessionControlRunLifecycleRepository
      yield* lifecycle.activate({ sessionId: SessionId('worker'), runId })
      const journal = yield* SessionControlOperationJournal
      yield* journal.claim({
        callerId,
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-interrupt',
          idempotencyKey: 'idempotency-interrupt',
          command: { operation: 'interrupt', sessionId: 'worker', expectedRunId: runId },
        },
        decide: (state) => ({
          accepted: true,
          state: { ...state, revision: state.revision + 1, run: { state: 'stopping', runId } },
        }),
      })
      yield* lifecycle.settle({
        sessionId: SessionId('worker'),
        runId,
        nextRunId: RunId('run-after'),
        terminalStatus: 'interrupted',
      })
      return yield* sql<{ readonly state: string; readonly trigger_caller_id: string | null }>`
        SELECT state, trigger_caller_id FROM session_orchestration_updates
      `
    }).pipe(Effect.provide(layer)),
  )
}

describe('SQLite Run interrupter', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-interrupter-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('names who stopped a Worker Run as the cause of its update', async () => {
    const updates = await interruptWorkerRunAs(
      path.join(temporaryRoot, 'profile.sqlite'),
      'profile:other',
    )

    expect(updates).toEqual([{ state: 'needs_attention', trigger_caller_id: 'profile:other' }])
  })
})
