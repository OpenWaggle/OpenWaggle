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
  beginEdit,
  edit,
  followUpEditLayer,
  HOLD,
  idleQueue,
  loadState,
  request,
  resetFollowUpEditRequests,
  SESSION,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

/** A caller that is not the person: an MCP client holding a transient authority. */
const AGENT = 'transient-mcp:digest-agent'

/** Fills a Run ceiling of one with a root Session's Run, which no longer counts. */
const busyRoot = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-busy'}, ${'/project'})`
  yield* sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${'run-busy'}, ${'session-busy'}, ${'active'}, ${null}, ${1}, ${1})
  `
  yield* sql`
    INSERT INTO session_control_states (
      session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
    ) VALUES (${'session-busy'}, ${1}, ${'run-busy'}, ${'running'}, ${0}, ${1})
  `
})

/**
 * Makes the target a Worker of the busy root and gives it an active sibling, so a Worker ceiling
 * of one is full, and has an agent author every queued Follow-up but `mine`.
 */
const busyWorkerHive = Effect.gen(function* () {
  yield* busyRoot
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS settings_store (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`)
  yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'worker-busy'}, ${'/project'})`
  yield* sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${'run-worker-busy'}, ${'worker-busy'}, ${'active'}, ${null}, ${1}, ${1})
  `
  yield* sql`
    INSERT INTO session_control_states (
      session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
    ) VALUES (${'worker-busy'}, ${1}, ${'run-worker-busy'}, ${'running'}, ${0}, ${1})
  `
  yield* sql`
    INSERT INTO session_spawn_lineage (
      child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
    ) VALUES
      (${'worker-busy'}, ${'session-busy'}, ${'run-busy'}, ${'session-busy'}, ${1}, ${1}),
      (${SESSION}, ${'session-busy'}, ${'run-busy'}, ${'session-busy'}, ${1}, ${2})
  `
  yield* sql`
    UPDATE session_follow_ups
    SET intent_json = json_set(intent_json, '$.callerId', ${AGENT})
    WHERE session_id = ${SESSION} AND id <> ${'mine'}
  `
})

describe('Follow-up edit holds do not strand a queue', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-edit-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('starts the next Follow-up when a held head is withdrawn from an idle Session', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'held' }, { id: 'next' }])
        yield* beginEdit('held')
        const withdrawn = yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['held'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('withdraw-held-head.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'started-run',
      followUpId: 'next',
      withdrawnFollowUpIds: ['held'],
    })
    expect(result.after.run).toMatchObject({ state: 'starting', intent: { text: 'Text of next' } })
  })

  it('starts an unheld Follow-up reordered ahead of the held one in an idle Session', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'held' }, { id: 'next' }])
        const begun = yield* beginEdit('held')
        if (begun.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
        const reordered = yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-reorder',
            sessionId: SESSION,
            expectedQueueRevision: begun.outcome.queueRevision,
            orderedFollowUpIds: ['next', 'held'],
          }),
        })
        return { reordered, after: yield* loadState() }
      }).pipe(Effect.provide(layer('reorder-ahead.sqlite'))),
    )

    expect(result.reordered.outcome).toMatchObject({ effect: 'started-run', followUpId: 'next' })
    expect(result.after.followUpQueue.items).toMatchObject([
      { id: 'held', editHold: { holdId: HOLD } },
    ])
  })

  it('starts the person’s edited Follow-up however many root Runs are active', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'held' }])
        const begun = yield* beginEdit('held')
        if (begun.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
        yield* busyRoot
        const saved = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-edit-save',
            sessionId: SESSION,
            followUpId: 'held',
            holdId: HOLD,
            expectedQueueRevision: begun.outcome.queueRevision,
            input: { text: 'Edited while busy', attachmentIds: [] },
          }),
        })
        return { saved, after: yield* loadState() }
      }).pipe(Effect.provide(layer('person-edit-busy.sqlite'))),
    )

    expect(result.saved.outcome).toMatchObject({
      operation: 'queue-edit-save',
      effect: 'started-run',
      followUpId: 'held',
    })
    expect(result.after.run).toMatchObject({
      state: 'starting',
      intent: { text: 'Edited while busy' },
    })
  })

  it('pauses a Worker’s agent Follow-up that an agent’s queue change would start at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-first' }, { id: 'agent-next' }])
        yield* busyWorkerHive
        const withdrawn = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-first'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('worker-ceiling-pause.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'queue-updated',
      queueState: 'paused',
      withdrawnFollowUpIds: ['agent-first'],
    })
    // No pause reason: older binaries decode a missing reason, and none names the Host ceiling.
    expect(result.after.followUpQueue).not.toHaveProperty('pauseReason')
    expect(result.after.followUpQueue.items).toMatchObject([{ id: 'agent-next' }])
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('starts a Worker’s agent Follow-up when the person resumes it at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-next' }], 'paused')
        yield* busyWorkerHive
        const before = yield* loadState()
        const resumed = yield* mutateSessionQueue({
          callerId: USER,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
          }),
        })
        return { resumed, after: yield* loadState() }
      }).pipe(Effect.provide(layer('worker-ceiling-resume.sqlite'))),
    )

    // The person's own queue action is never held back by the Worker limits.
    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('starts a failed Run’s retry that waited behind a hold once the hold is released', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([
          { id: 'earlier', acceptedAt: 100 },
          { id: 'retry', acceptedAt: 300 },
        ])
        yield* beginEdit('earlier')
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-failing'}, ${SESSION}, ${'active'}, ${null}, ${1}, ${1})
        `
        yield* sql`UPDATE session_control_states SET active_run_id = ${'run-failing'}`
        const settled = yield* SessionControlRunLifecycleRepository.pipe(
          Effect.flatMap((runs) =>
            runs.settle({
              sessionId: SessionId(SESSION),
              runId: RunId('run-failing'),
              nextRunId: RunId('run-retry'),
              terminalStatus: 'failed',
              terminalEventAt: 200,
            }),
          ),
        )
        const waiting = yield* loadState()
        const released = yield* edit({
          operation: 'queue-edit-cancel',
          sessionId: SESSION,
          followUpId: 'earlier',
          holdId: HOLD,
        })
        return { settled, waiting, released, after: yield* loadState() }
      }).pipe(Effect.provide(layer('deferred-retry.sqlite'))),
    )

    expect(result.settled).not.toHaveProperty('scheduled')
    expect(result.waiting.followUpQueue).toMatchObject({
      state: 'paused',
      deferredRetryAfter: 200,
    })
    expect(result.released.outcome).toMatchObject({ effect: 'started-run', followUpId: 'retry' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      items: [{ id: 'earlier' }],
    })
    expect(result.after.followUpQueue).not.toHaveProperty('deferredRetryAfter')
  })

  it('resumes a queue whose head authorization the Host re-checked against the stored revision', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'drifted' }], 'paused')
        const sql = yield* SqlClient.SqlClient
        // A stale block that the current authorization lifts on resumption.
        yield* sql`
          UPDATE session_follow_ups
          SET delivery_state = ${'needs_attention'}, attention_reason = ${'authority_changed'}
        `
        const stored = yield* loadState()
        const resumed = yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: stored.followUpQueue.revision,
          }),
        })
        return { resumed }
      }).pipe(Effect.provide(layer('resume-drift.sqlite'))),
    )

    expect(result.resumed.outcome).toMatchObject({ effect: 'started-run', followUpId: 'drifted' })
  })
})
