import { getEventListeners } from 'node:events'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { runEffectWithAbortSignal } from '../run-effect-with-abort-signal'

describe('runEffectWithAbortSignal', () => {
  it('leaves no listener on the caller signal once a run succeeds or fails', async () => {
    const controller = new AbortController()

    await expect(runEffectWithAbortSignal(Effect.succeed(1), controller.signal)).resolves.toBe(1)
    await expect(
      runEffectWithAbortSignal(Effect.fail(new Error('refused')), controller.signal),
    ).rejects.toThrow('refused')

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('interrupts a run in flight when the caller signal aborts', async () => {
    const controller = new AbortController()
    let interrupted = false
    const run = runEffectWithAbortSignal(
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (interrupted = true)))),
      controller.signal,
    )

    controller.abort(new Error('stopped'))

    await expect(run).rejects.toThrow()
    expect(interrupted).toBe(true)
  })

  it('runs without a signal', async () => {
    await expect(runEffectWithAbortSignal(Effect.succeed('done'))).resolves.toBe('done')
  })
})
