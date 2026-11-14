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

/**
 * A nested Queen: Worker `worker` answered its parent "still waiting for my own Worker" (revision
 * 1, unreviewed), went idle, and was woken when its own Worker reported. The woken Run's outcome
 * must reach the parent, or the parent only ever holds the stale answer.
 */
function settleWorkerRunAfterResult(
  file: string,
  input: {
    readonly hiveWake: boolean
    /** How the unreviewed result came: the Host captured a reply, or the Worker submitted it. */
    readonly resultProvenance?: 'host-captured' | 'agent-submitted'
    /** When the wake Run starts; the captured result is from 500. */
    readonly wakeStartedAt?: number
    readonly terminalStatus?: 'completed' | 'failed' | 'interrupted'
    readonly finalResponse?: string
  },
) {
  const layer = makeSessionControlRunLifecycleTestLayer(file)
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* prepareWorkerDelegation(sql)
      yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${'run-first'}, ${'worker'}, ${'completed'}, ${'{"callerId":"local-user"}'}, ${400}, ${450})`
      yield* sql`
        INSERT INTO delegation_submissions (
          delegation_id, revision, specification_revision, summary, submitted_by, source_run_id,
          provenance, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1}, ${1}, ${'Still waiting for my Worker.'}, ${'session-host'},
          ${'run-first'}, ${input.resultProvenance ?? 'host-captured'}, ${500}
        )
      `
      yield* sql`
        UPDATE delegation_contracts SET state = ${'ready_for_review'}
        WHERE id = ${'delegation-worker'}
      `
      yield* startWorkerRun
      if (input.hiveWake) {
        yield* sql`
          UPDATE session_runs SET intent_json = json_set(intent_json, '$.hiveWake', json('true'))
          WHERE id = ${'run-next'}
        `
      }
      if (input.wakeStartedAt !== undefined) {
        yield* sql`
          UPDATE session_runs SET created_at = ${input.wakeStartedAt} WHERE id = ${'run-next'}
        `
      }
      const lifecycle = yield* SessionControlRunLifecycleRepository
      yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
      const settlement = yield* lifecycle.settle({
        sessionId: SessionId('worker'),
        runId: RunId('run-next'),
        nextRunId: RunId('run-after'),
        terminalStatus: input.terminalStatus ?? 'completed',
        finalResponse:
          'finalResponse' in input
            ? input.finalResponse
            : 'All three sub-tasks are done; here is the combined result.',
      })
      const submissions = yield* sql<{ readonly revision: number; readonly source_run_id: string }>`
        SELECT revision, source_run_id FROM delegation_submissions
        WHERE delegation_id = ${'delegation-worker'} ORDER BY revision
      `
      const updates = yield* sql<{ readonly summary: string; readonly status: string }>`
        SELECT summary, status FROM session_orchestration_updates
        WHERE delegation_id = ${'delegation-worker'}
      `
      const [contract] = yield* sql<{ readonly state: string }>`
        SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
      `
      return { settlement, submissions, updates, state: contract?.state }
    }).pipe(Effect.provide(layer)),
  )
}

describe('SQLite Worker settlement of a woken nested Queen', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-wake-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('replaces the unreviewed result with the woken Run’s and tells the parent', async () => {
    const result = await settleWorkerRunAfterResult(path.join(temporaryRoot, 'woken.sqlite'), {
      hiveWake: true,
    })

    expect(result.submissions).toEqual([
      { revision: 1, source_run_id: 'run-first' },
      { revision: 2, source_run_id: 'run-next' },
    ])
    expect(result.updates).toEqual([
      { summary: 'All three sub-tasks are done; here is the combined result.', status: 'pending' },
    ])
    expect(result.settlement).toMatchObject({ orchestrationUpdate: { state: 'ready_for_review' } })
  })

  it('keeps the unreviewed result through a Run the Host did not start for new updates', async () => {
    const result = await settleWorkerRunAfterResult(path.join(temporaryRoot, 'chatted.sqlite'), {
      hiveWake: false,
    })

    expect(result.submissions).toEqual([{ revision: 1, source_run_id: 'run-first' }])
    expect(result.updates).toEqual([])
    expect(result.settlement).not.toHaveProperty('orchestrationUpdate')
  })

  it.each([
    { terminalStatus: 'failed' as const },
    { terminalStatus: 'interrupted' as const },
    { terminalStatus: 'completed' as const, finalResponse: '  ' },
  ])(
    'leaves the result reviewable when the wake ends $terminalStatus without a reply',
    async (end) => {
      const result = await settleWorkerRunAfterResult(
        path.join(temporaryRoot, `${end.terminalStatus}.sqlite`),
        { hiveWake: true, ...end },
      )

      expect(result.state).toBe('ready_for_review')
      expect(result.submissions).toEqual([{ revision: 1, source_run_id: 'run-first' }])
      expect(result.updates).toEqual([])
    },
  )

  it('replaces the result with a wake that started in the millisecond it was captured', async () => {
    const result = await settleWorkerRunAfterResult(path.join(temporaryRoot, 'same-ms.sqlite'), {
      hiveWake: true,
      wakeStartedAt: 500,
    })

    expect(result.submissions).toEqual([
      { revision: 1, source_run_id: 'run-first' },
      { revision: 2, source_run_id: 'run-next' },
    ])
  })

  it('keeps the result through a wake that started before it was captured', async () => {
    const result = await settleWorkerRunAfterResult(path.join(temporaryRoot, 'earlier.sqlite'), {
      hiveWake: true,
      wakeStartedAt: 499,
    })

    expect(result.submissions).toEqual([{ revision: 1, source_run_id: 'run-first' }])
  })

  it('keeps a result the Worker submitted itself through a wake that only replies', async () => {
    const result = await settleWorkerRunAfterResult(path.join(temporaryRoot, 'submitted.sqlite'), {
      hiveWake: true,
      resultProvenance: 'agent-submitted',
      finalResponse: 'Noted; my result is already submitted.',
    })

    expect(result.state).toBe('ready_for_review')
    expect(result.submissions).toEqual([{ revision: 1, source_run_id: 'run-first' }])
    expect(result.updates).toEqual([])
  })
})
