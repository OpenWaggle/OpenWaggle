import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'
import {
  prepareRunWithFollowUp,
  queueFollowUp,
  readSettlementState,
  submitMessage,
  UNSUCCESSFUL_TERMINAL_STATUSES,
} from './sqlite-session-control-settlement-test-support'

describe('SQLite Session Control settlement of work sent after a Run ended', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-retry-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  /*
   * The rule for work sent while a Run was ending: a failed or interrupted Run pauses only the
   * Follow-ups accepted before its terminal event. One accepted after it was sent by someone who had
   * seen the Run end (the error was on screen), so it is an explicit retry and starts normally.
   */
  describe('Follow-ups accepted after the terminal event', () => {
    it.each(UNSUCCESSFUL_TERMINAL_STATUSES)(
      'start normally after %s settlement',
      async (terminalStatus) => {
        const layer = makeSessionControlRunLifecycleTestLayer(
          path.join(temporaryRoot, `retry-${terminalStatus}.sqlite`),
        )
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const lifecycle = yield* prepareRunWithFollowUp()
            const settlement = yield* lifecycle.settle({
              sessionId: SessionId('session-target'),
              runId: RunId('run-next'),
              nextRunId: RunId('run-after'),
              terminalStatus,
              // The Follow-up was accepted at 1234, after the Run's terminal event.
              terminalEventAt: 1200,
            })
            return { settlement, ...(yield* readSettlementState()) }
          }).pipe(Effect.provide(layer)),
        )

        expect(result.settlement).toMatchObject({
          accepted: true,
          scheduled: { followUpId: 'follow-up-next', runId: 'run-after' },
        })
        expect(result).toMatchObject({
          state: { active_run_id: 'run-after', queue_state: 'running' },
          followUps: [],
          run: { status: terminalStatus },
          pauseReason: null,
        })
      },
    )

    it('still pause Follow-ups accepted before the terminal event', async () => {
      const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'held.sqlite'))
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const lifecycle = yield* prepareRunWithFollowUp()
          const settlement = yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
            nextRunId: RunId('run-after'),
            terminalStatus: 'failed',
            terminalEventAt: 1234,
          })
          return { settlement, ...(yield* readSettlementState()) }
        }).pipe(Effect.provide(layer)),
      )

      expect(result.settlement).not.toHaveProperty('scheduled')
      expect(result).toMatchObject({
        state: { active_run_id: null, queue_state: 'paused' },
        followUps: [{ id: 'follow-up-next' }],
        pauseReason: 'run-failed',
      })
    })

    it('start the first retry and keep earlier Follow-ups paused', async () => {
      let clock = 1000
      let followUpCount = 0
      const layer = makeSessionControlRunLifecycleTestLayer(
        path.join(temporaryRoot, 'mixed.sqlite'),
        {
          now: Effect.sync(() => clock),
          nextFollowUpId: Effect.sync(() => {
            followUpCount += 1
            return FollowUpId(`follow-up-${followUpCount}`)
          }),
        },
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const lifecycle = yield* prepareRunWithFollowUp()
          clock = 1300
          const retry = yield* queueFollowUp('Sent after the error.', 'retry')
          const settlement = yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
            nextRunId: RunId('run-after'),
            terminalStatus: 'failed',
            terminalEventAt: 1200,
          })
          return { retry, settlement, ...(yield* readSettlementState()) }
        }).pipe(Effect.provide(layer)),
      )

      const retryId =
        result.retry.outcome.effect === 'queued-follow-up' ? result.retry.outcome.followUpId : null
      expect(result.settlement).toMatchObject({
        accepted: true,
        scheduled: {
          followUpId: retryId,
          runId: 'run-after',
          intent: { text: 'Sent after the error.' },
        },
      })
      expect(result).toMatchObject({
        state: { active_run_id: 'run-after', queue_state: 'paused' },
        pauseReason: 'run-failed',
      })
      expect(result.followUps).toHaveLength(1)
      expect(result.followUps[0]?.id).not.toBe(retryId)
    })

    it('do not pause an empty queue', async () => {
      const layer = makeSessionControlRunLifecycleTestLayer(
        path.join(temporaryRoot, 'empty.sqlite'),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* submitMessage('Start working.', 'start')
          const lifecycle = yield* SessionControlRunLifecycleRepository
          yield* lifecycle.activate({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
          })
          yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
            nextRunId: RunId('run-after'),
            terminalStatus: 'failed',
            terminalEventAt: 1300,
          })
          return yield* readSettlementState()
        }).pipe(Effect.provide(layer)),
      )

      expect(result).toMatchObject({
        state: { active_run_id: null, queue_state: 'running' },
        pauseReason: null,
      })
    })
  })

  // A message sent to the idle Session after that settlement answers the failure: it starts a Run
  // instead of joining the queue the failure paused.
  it('starts a Run for a message sent after a failure paused the queue', async () => {
    let runCount = 0
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'message-after-failure.sqlite'),
      {
        nextRunId: Effect.sync(() => {
          runCount += 1
          return RunId(runCount === 1 ? 'run-next' : `run-${runCount}`)
        }),
      },
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithFollowUp()
        yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'failed',
          terminalEventAt: 1234,
        })
        const retry = yield* submitMessage('Try again.', 'retry-message')
        return { retry, ...(yield* readSettlementState()) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.retry.outcome.effect).toBe('started-run')
    const retryRunId =
      result.retry.outcome.effect === 'started-run' ? result.retry.outcome.runId : null
    expect(result).toMatchObject({
      state: { active_run_id: retryRunId, queue_state: 'paused' },
      followUps: [{ id: 'follow-up-next' }],
      pauseReason: 'run-failed',
    })
  })
})
