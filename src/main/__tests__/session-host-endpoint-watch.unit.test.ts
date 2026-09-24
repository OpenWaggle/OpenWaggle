import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  endpointExists: vi.fn(() => true),
}))

vi.mock('node:fs', () => ({ existsSync: mocks.endpointExists }))

import {
  UNADOPTABLE_HOST_SWEEP_INTERVAL_MS,
  watchUnadoptableSessionHostEndpoint,
} from '../session-host-cli-entry'

describe('unadoptable Session Host endpoint watch', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    mocks.endpointExists.mockReturnValue(true)
  })

  it('stops the Host once its endpoint socket is deleted', async () => {
    vi.useFakeTimers()
    const stop = vi.fn(async () => undefined)
    const stopWatching = watchUnadoptableSessionHostEndpoint({
      endpoint: '/tmp/openwaggle-profile/session-host.sock',
      endpointDirectory: '/tmp/openwaggle-profile',
      stop,
    })
    try {
      mocks.endpointExists.mockReturnValue(true)
      await vi.advanceTimersByTimeAsync(UNADOPTABLE_HOST_SWEEP_INTERVAL_MS)
      expect(stop).not.toHaveBeenCalled()

      mocks.endpointExists.mockReturnValue(false)
      await vi.advanceTimersByTimeAsync(UNADOPTABLE_HOST_SWEEP_INTERVAL_MS)
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      stopWatching()
      vi.useRealTimers()
    }
  })

  it('ignores endpoint watching for Windows named pipes', () => {
    const stop = vi.fn()
    const stopWatching = watchUnadoptableSessionHostEndpoint({
      endpoint: '',
      endpointDirectory: null,
      stop,
    })
    stopWatching()
    expect(stop).not.toHaveBeenCalled()
  })
})
