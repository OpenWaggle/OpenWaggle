import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createRunAttributionExtension } from '../run-attribution-extension'

describe('Pi Run attribution extension', () => {
  it('appends a non-model durable boundary when the Session starts', async () => {
    let sessionStart: (() => unknown) | undefined
    const appendEntry = vi.fn()
    await createRunAttributionExtension('run-exact')(
      fromPartial<ExtensionAPI>({
        appendEntry,
        on: vi.fn((event: unknown, handler: unknown) => {
          if (event === 'session_start' && typeof handler === 'function') {
            sessionStart = () => handler()
          }
        }),
      }),
    )

    sessionStart?.()

    expect(appendEntry).toHaveBeenCalledWith('openwaggle-run-boundary', {
      version: 1,
      runId: 'run-exact',
    })
  })
})
