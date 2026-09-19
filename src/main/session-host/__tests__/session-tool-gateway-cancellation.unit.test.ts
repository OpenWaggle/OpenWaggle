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
})
