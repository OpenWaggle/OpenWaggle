import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
  startWorkerRun,
} from './sqlite-session-control-run-lifecycle-test-layer'

describe('SQLite Session Control Worker settlement', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('captures a normally completed Worker result as a reviewable Delegation submission', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'worker-completed.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'Migration validated with all checks green.',
        })
        const contracts = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const submissions = yield* sql<{
          readonly summary: string
          readonly source_run_id: string
          readonly provenance: string
        }>`
          SELECT summary, source_run_id, provenance FROM delegation_submissions
          WHERE delegation_id = ${'delegation-worker'}
        `
        const updates = yield* sql<{ readonly state: string; readonly summary: string }>`
          SELECT state, summary FROM session_orchestration_updates
          WHERE delegation_id = ${'delegation-worker'}
        `
        return {
          settlement,
          contract: contracts[0],
          submission: submissions[0],
          update: updates[0],
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      settlement: {
        accepted: true,
        delegationUpdate: {
          delegationId: 'delegation-worker',
          parentSessionId: SessionId('queen'),
          state: 'ready_for_review',
          submissionRevision: 1,
        },
        orchestrationUpdate: { parentSessionId: SessionId('queen'), state: 'ready_for_review' },
      },
      contract: { state: 'ready_for_review' },
      submission: {
        summary: 'Migration validated with all checks green.',
        source_run_id: 'run-next',
        provenance: 'host-captured',
      },
      update: { state: 'ready_for_review', summary: 'Migration validated with all checks green.' },
    })
  })

  function settleCompletedRunAfterNeedsAttention(
    file: string,
    markNeedsAttention: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>,
  ) {
    const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, file))
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        yield* markNeedsAttention(sql)
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'I need the staging credentials before I can continue.',
        })
        const [contract] = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const [submissions] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM delegation_submissions
          WHERE delegation_id = ${'delegation-worker'}
        `
        return { settlement, contract, submissionCount: submissions?.count }
      }).pipe(Effect.provide(layer)),
    )
  }

  it('keeps a needs_attention state the Worker set itself when its Run completes with text', async () => {
    const result = await settleCompletedRunAfterNeedsAttention(
      'worker-explicit-needs-attention.sqlite',
      (sql) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO delegation_state_transitions (
              delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
            ) VALUES (
              ${'delegation-worker'}, ${'working'}, ${'needs_attention'}, ${'Blocked on credentials'},
              ${'worker'}, ${'session-agent:worker'}, ${2000}
            )
          `
          yield* sql`
            UPDATE delegation_contracts SET state = ${'needs_attention'}, updated_at = ${2000}
            WHERE id = ${'delegation-worker'}
          `
        }),
    )

    expect(result.settlement).toEqual(
      expect.not.objectContaining({ delegationUpdate: expect.anything() }),
    )
    expect(result).toMatchObject({ contract: { state: 'needs_attention' }, submissionCount: 0 })
  })

  it('still submits a completed Run whose needs_attention the Host set after an earlier failure', async () => {
    const result = await settleCompletedRunAfterNeedsAttention(
      'worker-host-needs-attention.sqlite',
      (sql) =>
        Effect.gen(function* () {
          // An older explicit transition, then a Host needs_attention settlement after a failed Run.
          yield* sql`
            INSERT INTO delegation_state_transitions (
              delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
            ) VALUES (
              ${'delegation-worker'}, ${'working'}, ${'needs_attention'}, ${'Blocked'},
              ${'worker'}, ${'session-agent:worker'}, ${1500}
            )
          `
          yield* sql`
            UPDATE delegation_contracts SET state = ${'needs_attention'}, updated_at = ${3000}
            WHERE id = ${'delegation-worker'}
          `
          yield* sql`
            INSERT INTO session_orchestration_updates (
              id, parent_session_id, worker_session_id, delegation_id, source_run_id,
              state, summary, status, created_at
            ) VALUES (
              ${'orchestration:delegation-worker:run-next:needs-attention'}, ${'queen'}, ${'worker'},
              ${'delegation-worker'}, ${'run-next'}, ${'needs_attention'}, ${'Run failed.'},
              ${'pending'}, ${3000}
            )
          `
        }),
    )

    expect(result).toMatchObject({
      settlement: { delegationUpdate: { state: 'ready_for_review', submissionRevision: 1 } },
      contract: { state: 'ready_for_review' },
      submissionCount: 1,
    })
  })

  it('marks an interrupted Worker Delegation as needing attention without submitting it', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'worker-interrupted.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
        })
        const contracts = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const submissions = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM delegation_submissions
          WHERE delegation_id = ${'delegation-worker'}
        `
        return { settlement, contract: contracts[0], submissionCount: submissions[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      settlement: { delegationUpdate: { state: 'needs_attention' } },
      contract: { state: 'needs_attention' },
      submissionCount: 0,
    })
  })

  it('marks a completed Worker without a textual result as needing attention', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'worker-completed-without-result.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: '   ',
        })
        const [contract] = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const [submissions] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM delegation_submissions
          WHERE delegation_id = ${'delegation-worker'}
        `
        const [update] = yield* sql<{ readonly state: string; readonly summary: string }>`
          SELECT state, summary FROM session_orchestration_updates
          WHERE delegation_id = ${'delegation-worker'}
        `
        return { settlement, contract, submissionCount: submissions?.count, update }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      settlement: {
        delegationUpdate: { state: 'needs_attention' },
        orchestrationUpdate: { state: 'needs_attention' },
      },
      contract: { state: 'needs_attention' },
      submissionCount: 0,
      update: {
        state: 'needs_attention',
        summary: 'Worker Run run-next completed without a textual final response.',
      },
    })
  })
})
