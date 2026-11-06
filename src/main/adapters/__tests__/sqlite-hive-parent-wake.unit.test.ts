import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionOrchestrationUpdateRepository } from '../../ports/session-orchestration-update-repository'
import {
  candidate,
  delegationRequest,
  type HiveWakeTestServices,
  insertParentRun,
  markRead,
  pendingUpdates,
  runHiveWakeTest,
  settleParentRun,
  submit,
  WORKER_AGENT,
} from './sqlite-hive-parent-wake-test-support'

describe('Hive wake: Worker updates reach an idle parent', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-wake-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const run = <A, E>(effect: Effect.Effect<A, E, HiveWakeTestServices>) =>
    runHiveWakeTest(root, effect)

  it('records an update for the parent when a Worker submits its result itself', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        return yield* pendingUpdates(sql)
      }),
    )

    // Before the fix only a Worker Run's end recorded an update, and it skipped a Delegation the
    // Worker had already submitted, so its parent was never told.
    expect(result).toEqual([
      {
        parent_session_id: 'session-parent',
        worker_session_id: 'session-worker',
        source_run_id: 'run-worker',
        state: 'ready_for_review',
        summary: 'Drafted the six epics.',
        status: 'pending',
        created_at: 3000,
      },
    ])
  })

  it('records an update for the parent when a Worker asks it for help', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const delegations = yield* SessionDelegationRepository
        yield* delegations.execute({
          callerId: WORKER_AGENT,
          request: delegationRequest('help', {
            operation: 'delegation-state',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            state: 'needs_attention',
            reason: 'Which Jira project should the epics go to?',
          }),
          now: 3000,
        })
        yield* delegations.execute({
          callerId: WORKER_AGENT,
          request: delegationRequest('waiting', {
            operation: 'delegation-state',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            state: 'waiting',
            reason: 'Waiting for the answer.',
          }),
          now: 3100,
        })
        return yield* pendingUpdates(sql)
      }),
    )

    expect(result).toMatchObject([
      {
        state: 'needs_attention',
        summary: 'Which Jira project should the epics go to?',
        status: 'pending',
      },
    ])
  })

  it('wakes an idle parent for an update that arrived after its latest Run started', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql, {
          callerId: 'profile:cli',
          runAuthorizationOverride: 'ask-for-approval',
        })
        const beforeAnyUpdate = yield* candidate()
        yield* submit(3000)
        return { beforeAnyUpdate, afterSubmit: yield* candidate() }
      }),
    )

    // The wake acts for the latest Run's caller and keeps that Run's Run mode override.
    expect(result).toEqual({
      beforeAnyUpdate: undefined,
      afterSubmit: {
        parentSessionId: 'session-parent',
        latestRunId: 'run-parent',
        callerId: 'profile:cli',
        runAuthorizationOverride: 'ask-for-approval',
        piSessionFile: null,
      },
    })
  })

  it('does not wake a parent that is running, archived, or was stopped', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        const running = yield* candidate()
        yield* settleParentRun(sql, { status: 'interrupted' })
        const stopped = yield* candidate()
        yield* sql`UPDATE session_runs SET status = ${'completed'} WHERE id = ${'run-parent'}`
        yield* sql`UPDATE sessions SET archived = ${1} WHERE id = ${'session-parent'}`
        const archived = yield* candidate()
        return { running, stopped, archived }
      }),
    )

    expect(result).toEqual({ running: undefined, stopped: undefined, archived: undefined })
  })

  it('wakes a parent once per update: a Run that started after it ends the claim', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql)
        yield* submit(3000)
        // A wake Run (or any Run) started after the update and failed before it loaded it.
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (
            ${'run-wake'}, ${'session-parent'}, ${'failed'},
            ${JSON.stringify({ callerId: 'local-user' })}, ${3500}, ${3600}
          )
        `
        return yield* candidate()
      }),
    )

    expect(result).toBeUndefined()
  })

  it('wakes for an update no model request read, never for one a request read', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        const updates = yield* SessionOrchestrationUpdateRepository
        const [pending] = yield* updates.listPending({ parentSessionId: 'session-parent' })
        if (!pending) throw new Error('missing update')
        // Delivered during the parent's final turn: in its transcript, but no request read it.
        yield* settleParentRun(sql)
        const unread = yield* candidate()
        yield* markRead(pending.updateId, 'run-parent')
        return { unread, read: yield* candidate() }
      }),
    )

    expect(result).toEqual({
      unread: expect.objectContaining({ latestRunId: 'run-parent' }),
      read: undefined,
    })
  })

  it('wakes once for an older update a completed Run missed, but not after a wake or failure', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql)
        yield* submit(3000)
        // A later Run of the parent missed it (it was committed after that Run listed updates).
        yield* insertParentRun(sql, { id: 'run-missed', status: 'completed' })
        const afterCompleted = yield* candidate()
        yield* insertParentRun(sql, { id: 'run-wake', status: 'completed', hiveWake: true })
        const afterWake = yield* candidate()
        yield* sql`DELETE FROM session_runs WHERE id = ${'run-wake'}`
        yield* sql`UPDATE session_runs SET status = ${'failed'} WHERE id = ${'run-missed'}`
        const afterFailed = yield* candidate()
        return { afterCompleted, afterWake, afterFailed }
      }),
    )

    expect(result).toEqual({
      afterCompleted: expect.objectContaining({ latestRunId: 'run-missed' }),
      afterWake: undefined,
      afterFailed: undefined,
    })
  })
})
