import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editSessionFollowUp } from '../../application/session-control-queue-edit-service'
import { mutateSessionQueue } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  retainedFollowUpEditAttachmentIds,
  retainFollowUpEditAttachments,
} from '../sqlite-follow-up-edit-holds'
import {
  activeRunWithQueuedFollowUp,
  beginEdit,
  FOLLOW_UP,
  followUpEditLayer,
  idleQueue,
  request,
  resetFollowUpEditRequests,
  SESSION,
  settleRun,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'

let tmpRoot = ''

/** The Session is a Worker of `queen` under a working Delegation. */
const workerDelegation = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'queen'}, ${'/project'})`
  yield* sql`
    INSERT INTO delegation_contracts (
      id, parent_session_id, child_session_id, state,
      current_specification_revision, created_at, updated_at
    ) VALUES (${'delegation-1'}, ${'queen'}, ${SESSION}, ${'working'}, ${1}, ${1}, ${1})
  `
  yield* sql`
    INSERT INTO delegation_specifications (
      delegation_id, revision, specification_json, authored_by, created_at
    ) VALUES (${'delegation-1'}, ${1}, ${'{"objective":"Answer"}'}, ${'queen'}, ${1})
  `
})

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

describe('Follow-up edit holds across replays, Workers, and attachments', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-edit-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('does not hand back a dead hold when a begin is replayed', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'held' }])
        const beginRequest = request({
          operation: 'queue-edit-begin',
          sessionId: SESSION,
          followUpId: 'held',
        })
        const first = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          request: beginRequest,
        })
        const live = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          request: beginRequest,
        })
        const sql = yield* SqlClient.SqlClient
        // A Host restart drops the TEMP tables.
        yield* sql`DELETE FROM temp.session_follow_up_edit_holds`
        const dead = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          request: beginRequest,
        })
        return { first, live, dead }
      }).pipe(Effect.provide(layer('replayed-begin.sqlite'))),
    )

    expect(result.live).toEqual({ ...result.first, replayed: true })
    expect(result.dead).toMatchObject({
      replayed: true,
      outcome: { effect: 'rejected', code: 'follow_up_edit_not_held' },
    })
  })

  it('keeps a Worker’s Delegation working while a held Follow-up waits to be delivered', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* workerDelegation
        yield* activeRunWithQueuedFollowUp
        yield* beginEdit(FOLLOW_UP)
        const runs = yield* SessionControlRunLifecycleRepository
        yield* runs.settle({
          sessionId: SessionId(SESSION),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'An intermediate answer',
        })
        const delegationState = () =>
          sql<{ readonly state: string }>`
            SELECT state FROM delegation_contracts WHERE id = ${'delegation-1'}
          `.pipe(Effect.map((rows) => rows[0]?.state))
        const whileHeld = yield* delegationState()
        const settledWhileHeld = yield* runs.settleDeferredWorkerDelegation?.({
          sessionId: SessionId(SESSION),
        }) ?? Effect.succeed(undefined)
        const stillHeld = yield* delegationState()
        // Withdrawing the held Follow-up ends the wait without a Run: the deferred result settles.
        yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: [FOLLOW_UP],
          }),
        })
        const settled = yield* runs.settleDeferredWorkerDelegation?.({
          sessionId: SessionId(SESSION),
        }) ?? Effect.succeed(undefined)
        const afterWithdraw = yield* delegationState()
        const again = yield* runs.settleDeferredWorkerDelegation?.({
          sessionId: SessionId(SESSION),
        }) ?? Effect.succeed(undefined)
        return { whileHeld, settledWhileHeld, stillHeld, settled, afterWithdraw, again }
      }).pipe(Effect.provide(layer('worker-delegation.sqlite'))),
    )

    expect(result.whileHeld).toBe('working')
    expect(result.settledWhileHeld).toBeUndefined()
    expect(result.stillHeld).toBe('working')
    expect(result.settled?.delegationUpdate).toMatchObject({
      delegationId: 'delegation-1',
      state: 'ready_for_review',
    })
    expect(result.afterWithdraw).toBe('ready_for_review')
    expect(result.again).toBeUndefined()
  })

  it('settles a Worker whose held Follow-up waits in a paused queue', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* workerDelegation
        yield* activeRunWithQueuedFollowUp
        const held = yield* beginEdit(FOLLOW_UP)
        if (held.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
        yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-pause',
            sessionId: SESSION,
            expectedQueueRevision: held.outcome.queueRevision,
          }),
        })
        const runs = yield* SessionControlRunLifecycleRepository
        yield* runs.settle({
          sessionId: SessionId(SESSION),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'The answer',
        })
        const rows = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-1'}
        `
        return rows[0]?.state
      }).pipe(Effect.provide(layer('worker-paused.sqlite'))),
    )

    expect(result).toBe('ready_for_review')
  })

  it('withdraws a held Follow-up together with its hold', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* beginEdit(FOLLOW_UP)
        yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: [FOLLOW_UP],
          }),
        })
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM temp.session_follow_up_edit_holds
        `
      }).pipe(Effect.provide(layer('withdraw.sqlite'))),
    )
    expect(result[0]?.count).toBe(0)
  })

  it('retains the attachments an edit names after nothing references them', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* beginEdit(FOLLOW_UP)
        const sql = yield* SqlClient.SqlClient
        yield* retainFollowUpEditAttachments(
          sql,
          { sessionId: SESSION, attachmentIds: ['attachment-draft'] },
          performance.now(),
        )
        yield* settleRun()
        return yield* retainedFollowUpEditAttachmentIds(sql, SESSION, performance.now())
      }).pipe(Effect.provide(layer('retention.sqlite'))),
    )
    expect(result).toEqual(['attachment-draft'])
  })
})
