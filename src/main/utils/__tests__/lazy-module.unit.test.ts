import { describe, expect, it, vi } from 'vitest'
import { lazyModule } from '../lazy-module'

describe('lazyModule', () => {
  it('does not load until first use and then loads once', async () => {
    const load = vi.fn(async () => ({ value: 42 }))
    const loadModule = lazyModule(load)

    expect(load).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([loadModule(), loadModule()])
    const third = await loadModule()

    expect(load).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(third).toBe(first)
  })

  it('retries after a failed load', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('missing native module'))
      .mockResolvedValueOnce('loaded')
    const loadModule = lazyModule(load)

    await expect(loadModule()).rejects.toThrow('missing native module')
    await expect(loadModule()).resolves.toBe('loaded')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
