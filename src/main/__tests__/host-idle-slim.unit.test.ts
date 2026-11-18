import { afterEach, describe, expect, it, vi } from 'vitest'

const piCache = vi.hoisted(() => ({ release: vi.fn() }))

vi.mock('../adapters/pi/pi-parsed-session-file-cache', () => ({
  releaseParsedPiSessionFiles: piCache.release,
}))

import { defaultSessionEmbeddingModel } from '../adapters/multilingual-e5-session-embedding-model'
import { HOST_IDLE_SLIM_DELAY_MS, hostBackgroundGate } from '../application/host-background-gate'
import { installHostIdleSlim } from '../host-idle-slim'
import { hostMcpConnectionPool } from '../mcp-runtime-layers'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('idle-slim Session Host (decision 4)', () => {
  it('closes idle MCP servers, ends the embedding process and releases parsed Pi files once no client is attached', async () => {
    vi.useFakeTimers()
    const closeIdle = vi.spyOn(hostMcpConnectionPool, 'closeIdleSessions').mockResolvedValue()
    const dispose = vi.spyOn(defaultSessionEmbeddingModel, 'dispose').mockReturnValue(true)
    const uninstall = installHostIdleSlim()
    expect(hostBackgroundGate.isOpen).toBe(false)

    const detach = hostBackgroundGate.clientAttached()
    detach()
    await vi.advanceTimersByTimeAsync(HOST_IDLE_SLIM_DELAY_MS)

    expect(closeIdle).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(piCache.release).toHaveBeenCalledTimes(1)
    uninstall()
  })
})
