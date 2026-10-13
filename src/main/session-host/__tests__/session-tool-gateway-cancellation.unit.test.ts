import { getEventListeners } from 'node:events'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { runSessionToolCallerResolution } from '../session-tool-gateway-cancellation'

describe('Session tool gateway caller resolution cancellation', () => {
  it('does not admit a command after its Run is cancelled during caller resolution', async () => {
    const controller = new AbortController()
    const resolution = Effect.async<string>((resume) => {
      controller.abort(new Error('run interrupted'))
      resume(Effect.succeed('caller'))
    })

    await expect(runSessionToolCallerResolution(resolution, controller.signal)).rejects.toThrow()
  })

  it('leaves no abort listener behind on a long-lived signal', async () => {
    // A Session wait re-resolves its caller on every target event with the same signal.
    const controller = new AbortController()
    for (let index = 0; index < 50; index += 1) {
      await runSessionToolCallerResolution(Effect.succeed('caller'), controller.signal)
      await runSessionToolCallerResolution(
        Effect.promise(async () => 'caller'),
        controller.signal,
      )
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('still interrupts a resolution in flight when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = runSessionToolCallerResolution(Effect.never, controller.signal)
    controller.abort(new Error('run interrupted'))

    await expect(pending).rejects.toThrow()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })
})
