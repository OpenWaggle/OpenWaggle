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
})
