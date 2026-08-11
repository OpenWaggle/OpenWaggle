import { describe, expect, it, vi } from 'vitest'
import { completeAppRuntimeShutdown } from '../app-runtime-shutdown'

describe('app runtime shutdown', () => {
  it('awaits runtime disposal after active runs are persisted', async () => {
    const events: string[] = []
    const disposal = Promise.withResolvers<void>()
    const shutdown = completeAppRuntimeShutdown({
      persistActiveRuns: vi.fn(async () => {
        events.push('persisted')
      }),
      disposeRuntime: vi.fn(async () => {
        events.push('disposing')
        await disposal.promise
        events.push('disposed')
      }),
    })

    await vi.waitFor(() => expect(events).toEqual(['persisted', 'disposing']))
    let settled = false
    void shutdown.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    disposal.resolve()
    await shutdown
    expect(events).toEqual(['persisted', 'disposing', 'disposed'])
  })

  it('still disposes the runtime when active-run persistence fails', async () => {
    const disposeRuntime = vi.fn(async () => undefined)

    await expect(
      completeAppRuntimeShutdown({
        persistActiveRuns: async () => {
          throw new Error('persistence failed')
        },
        disposeRuntime,
      }),
    ).rejects.toThrow('persistence failed')
    expect(disposeRuntime).toHaveBeenCalledTimes(1)
  })
})
