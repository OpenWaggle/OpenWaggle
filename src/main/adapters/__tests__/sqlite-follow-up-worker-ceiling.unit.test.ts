import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editSessionFollowUp } from '../../application/session-control-queue-edit-service'
import { mutateSessionQueue } from '../../application/session-control-service'
import {
  beginEdit,
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

/** A caller that is not the person: an MCP client holding a transient authority. */
const AGENT = 'transient-mcp:digest-agent'

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

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
 * of one is full, and has an agent author every Follow-up whose id starts `agent-`.
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
    WHERE session_id = ${SESSION} AND id LIKE ${'agent-%'}
  `
})

/*
 * The Active Workers ceiling holds back only what agents start (ADR 0030, amended 2026-11-09).
 * The person's own queue action delivers its Run whatever the limits, even an agent's Follow-up.
 */
describe('Queue delivery and the Worker ceiling', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-ceiling-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
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

  it('starts the agent’s next Follow-up the person’s withdraw delivers at the Worker ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'mine' }, { id: 'agent-next' }])
        yield* busyWorkerHive
        const withdrawn = yield* mutateSessionQueue({
          callerId: USER,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['mine'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('person-withdraw.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('starts the agent’s Follow-up when the person resumes a Worker’s queue at the ceiling', async () => {
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
      }).pipe(Effect.provide(layer('person-resume.sqlite'))),
    )

    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('refuses an agent’s resume of a Worker’s queue at the Worker ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-next' }], 'paused')
        yield* busyWorkerHive
        const before = yield* loadState()
        const resumed = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
          }),
        })
        return { resumed, after: yield* loadState() }
      }).pipe(Effect.provide(layer('agent-resume.sqlite'))),
    )

    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.after.followUpQueue).toMatchObject({ state: 'paused' })
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('pauses the queue when an agent’s withdraw would start a Worker Run at the ceiling', async () => {
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
      }).pipe(Effect.provide(layer('agent-withdraw.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'queue-updated',
      queueState: 'paused',
    })
    // No pause reason: older binaries decode a missing reason, and none names the Host ceiling.
    expect(result.after.followUpQueue).not.toHaveProperty('pauseReason')
    expect(result.after.run).toEqual({ state: 'idle' })
  })
})
