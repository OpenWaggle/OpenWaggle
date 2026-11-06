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
import { persistAndRecordStop } from '../sqlite-run-interrupter'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import { loadSessionControlState } from '../sqlite-session-control-state'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
  startWorkerRun,
} from './sqlite-session-control-run-lifecycle-test-layer'

/**
 * A client that stops a Worker Run causes that Run's end: its update names the client, so a
 * client that may only interrupt a Worker cannot wake the Worker's parent through it.
 */
function interruptWorkerRunAs(
  file: string,
  /** Who stops the Run, in order; none leaves it running until it ends. */
  stoppers: readonly string[],
  end: {
    readonly terminalStatus: 'interrupted' | 'completed' | 'failed'
    readonly finalResponse?: string
  } = {
    terminalStatus: 'interrupted',
  },
) {
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
      for (const [index, callerId] of stoppers.entries()) {
        yield* journal.claim({
          callerId,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: `request-interrupt-${index}`,
            idempotencyKey: `idempotency-interrupt-${index}`,
            command: { operation: 'interrupt', sessionId: 'worker', expectedRunId: runId },
          },
          decide: (state) => ({
            accepted: true,
            state: { ...state, revision: state.revision + 1, run: { state: 'stopping', runId } },
          }),
        })
      }
      yield* lifecycle.settle({
        sessionId: SessionId('worker'),
        runId,
        nextRunId: RunId('run-after'),
        ...end,
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
    const updates = await interruptWorkerRunAs(path.join(temporaryRoot, 'profile.sqlite'), [
      'profile:other',
      // A stop of a Run already stopping records nothing (the Host refuses one anyway).
      'local-user',
    ])

    expect(updates).toEqual([{ state: 'needs_attention', trigger_caller_id: 'profile:other' }])
  })

  // The Run finished before the stop reached it: the stop changed nothing.
  it('names the Worker Run’s own agent for a result a late stop did not prevent', async () => {
    const updates = await interruptWorkerRunAs(
      path.join(temporaryRoot, 'late-stop.sqlite'),
      ['profile:other'],
      { terminalStatus: 'completed', finalResponse: 'Validated the migration.' },
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ state: 'ready_for_review' })
    expect(updates[0]?.trigger_caller_id).toMatch(/^session-agent:worker:/)
  })

  it('names the Worker Run’s own agent when nobody stopped it', async () => {
    const updates = await interruptWorkerRunAs(path.join(temporaryRoot, 'unstopped.sqlite'), [], {
      terminalStatus: 'completed',
      finalResponse: 'Validated the migration.',
    })

    expect(updates[0]?.trigger_caller_id).toMatch(/^session-agent:worker:/)
  })

  // A Run that failed after a stop may have failed because of it, so the stopper still caused it.
  it('names who stopped a Worker Run that then failed', async () => {
    const updates = await interruptWorkerRunAs(
      path.join(temporaryRoot, 'failed.sqlite'),
      ['profile:other'],
      { terminalStatus: 'failed' },
    )

    expect(updates).toEqual([{ state: 'needs_attention', trigger_caller_id: 'profile:other' }])
  })

  // Both Session Control write paths record through this helper; a recorded stopper is kept.
  it('keeps the first recorded stopper of a Run', async () => {
    const file = path.join(temporaryRoot, 'first-stop.sqlite')
    const stoppers = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        const started = yield* startWorkerRun
        if (started.outcome.effect !== 'started-run') throw new Error(started.outcome.effect)
        const runId = RunId(started.outcome.runId)
        yield* (yield* SessionControlRunLifecycleRepository).activate({
          sessionId: SessionId('worker'),
          runId,
        })
        const active = yield* loadSessionControlState(sql, 'worker')
        const stopping = { ...active, run: { state: 'stopping' as const, runId } }
        yield* persistAndRecordStop(sql, active, stopping, 'profile:first', 2000)
        yield* persistAndRecordStop(sql, active, stopping, 'profile:second', 2001)
        return yield* sql<{ readonly interrupted_by_caller_id: string | null }>`
          SELECT interrupted_by_caller_id FROM session_runs WHERE id = ${runId}
        `
      }).pipe(Effect.provide(makeSessionControlRunLifecycleTestLayer(file))),
    )

    expect(stoppers).toEqual([{ interrupted_by_caller_id: 'profile:first' }])
  })
})
