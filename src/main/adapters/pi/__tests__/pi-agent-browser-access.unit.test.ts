import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { readBrowserPreviewAutomationEnabled } from '../pi-agent-kernel-adapter'

describe('Pi agent browser access gate', () => {
  it.each([
    [true, true],
    [false, false],
  ])('maps the persisted setting %s to %s', async (configured, expected) => {
    await expect(
      Effect.runPromise(
        readBrowserPreviewAutomationEnabled({
          get: () => Effect.succeed({ enableAgentBrowserAccess: configured }),
        }),
      ),
    ).resolves.toBe(expected)
  })

  it('fails closed when reading settings defects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      Effect.runPromise(
        readBrowserPreviewAutomationEnabled({
          get: () => Effect.die(new Error('settings unavailable')),
        }),
      ),
    ).resolves.toBe(false)
    error.mockRestore()
  })
})
