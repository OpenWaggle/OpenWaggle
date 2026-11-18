import { RunId, SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as TestClock from 'effect/TestClock'
import * as TestContext from 'effect/TestContext'
import { describe, expect, it, vi } from 'vitest'
import { withRunAttachmentCleanup } from '../../adapters/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  interruptExactSessionRun,
  reserveActiveSessionRun,
  waitForSessionRuns,
} from '../active-session-runs'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import { RUN_INTERRUPTION_SETTLEMENT_WAIT_MS } from '../session-control-interruption-settlement'
import {
  controlPayload,
  localUser,
  settingsLayer,
} from './local-session-command-dispatcher.test-support'
import { unusedDispatcherCommandDependencies } from './local-session-command-dispatcher-dependencies.test-support'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

function interruptLiveRun(input: { readonly sessionId: string; readonly runId: string }) {
  return Effect.promise(() =>
    interruptExactSessionRun(SessionId(input.sessionId), input.runId),
  ).pipe(
    Effect.map((accepted) =>
      accepted
        ? { accepted: true as const }
        : { accepted: false as const, code: 'run_not_live' as const },
    ),
  )
}

const DEADLOCK_PROBE_MS = 2_000

function settlesWithin<A>(promise: Promise<A>, timeoutMs: number) {
  return Promise.race([
    promise.then((value) => ({ settled: true as const, value })),
    new Promise<{ readonly settled: false }>((resolve) =>
      setTimeout(() => resolve({ settled: false }), timeoutMs),
    ),
  ])
}

describe('Local Session command control of a live Run', () => {
  it('replaces a live Run whose teardown releases its attachments under the same transition', async () => {
    const sessionId = SessionId('session-replace-live-run')
    const runId = RunId('run-live')
    const run = reserveActiveSessionRun(sessionId, runId)
    const releasedRunAttachments = vi.fn()
    const setup = makePromotionReplacementLayer(
      {
        sessionId,
        revision: 3,
        run: { state: 'active', runId },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      { interrupt: interruptLiveRun },
    )
    const layer = Layer.mergeAll(
      settingsLayer,
      unusedDispatcherCommandDependencies(),
      setup.layer,
      // The replacement Run's coordinator finds nothing to start, so it ends at once.
      Layer.succeed(
        SessionControlRunLifecycleRepository,
        fromPartial({
          activate: () =>
            Effect.succeed({ accepted: false as const, code: 'run_not_starting' as const }),
        }),
      ),
    )
    // The live Run as the production executor owns it: once aborted, it releases its own
    // attachments under the Session attachment transition, and only then settles.
    const liveRun = Effect.runPromise(
      withRunAttachmentCleanup({
        effect: Effect.async<void>((resume) => {
          if (run.controller.signal.aborted) return resume(Effect.void)
          run.controller.signal.addEventListener('abort', () => resume(Effect.void), {
            once: true,
          })
        }),
        attachments: {
          release: (input) => Effect.sync(() => releasedRunAttachments(input.attachmentIds)),
        },
        attachmentIds: ['attachment-live-run'],
        sessionId,
        runId,
        ownerCallerId: localUser.callerId,
      }).pipe(Effect.ensuring(Effect.sync(run.release))),
    )

    const replace = Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'replace',
          sessionId,
          expectedRunId: runId,
          input: { text: 'Start over.', attachmentIds: [] },
        }),
      }).pipe(Effect.provide(layer)),
    )
    try {
      const outcome = await settlesWithin(replace, DEADLOCK_PROBE_MS)
      expect(outcome.settled).toBe(true)
      await expect(replace).resolves.toMatchObject({
        response: {
          outcome: { effect: 'replaced-run', interruptedRunId: runId, runId: 'run-replacement' },
        },
      })
      await liveRun
      expect(releasedRunAttachments).toHaveBeenCalledWith(['attachment-live-run'])
      await expect(waitForSessionRuns(sessionId, DEADLOCK_PROBE_MS)).resolves.toBe(true)
    } finally {
      // Break a deadlock so a failing assertion does not leak a parked fiber into other tests.
      run.release()
      await replace.catch(() => undefined)
      await liveRun
    }
  })

  it('answers Stop once the settlement bound passes when the aborted Run never settles', async () => {
    const sessionId = SessionId('session-stop-unsettled-run')
    const runId = RunId('run-unsettled')
    const run = reserveActiveSessionRun(sessionId, runId)
    const setup = makePromotionReplacementLayer(
      {
        sessionId,
        revision: 4,
        run: { state: 'active', runId },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      { interrupt: interruptLiveRun },
    )
    const layer = Layer.mergeAll(settingsLayer, unusedDispatcherCommandDependencies(), setup.layer)
    try {
      const stop = await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            dispatchAdmittedSessionControlCommand({
              caller: localUser,
              payload: controlPayload({ operation: 'interrupt', sessionId, expectedRunId: runId }),
            }),
          )
          // Let the command reach the Run's abort and arm its settlement bound.
          for (let turn = 0; turn < 100 && !run.controller.signal.aborted; turn += 1) {
            yield* Effect.yieldNow()
          }
          expect(run.controller.signal.aborted).toBe(true)
          yield* TestClock.adjust(Duration.millis(RUN_INTERRUPTION_SETTLEMENT_WAIT_MS - 1))
          expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true)
          yield* TestClock.adjust(Duration.millis(1))
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(layer), Effect.provide(TestContext.TestContext)),
      )

      expect(stop).toMatchObject({
        response: { outcome: { effect: 'interruption-requested', runId } },
      })
      // The Run still owns the Session until its teardown settles it.
      expect(setup.state().run).toEqual({ state: 'stopping', runId })
    } finally {
      run.release()
    }
  })
})
