import { describe, expect, it, vi } from 'vitest'
import { attempt, withFinally } from '../async-outcome'

describe('withFinally', () => {
  it('runs the cleanup after a result and after a failure', async () => {
    const after = vi.fn()
    await expect(withFinally(async () => 'done', after)).resolves.toBe('done')
    const failure = new Error('failed')
    await expect(
      withFinally(async () => {
        throw failure
      }, after),
    ).rejects.toBe(failure)
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('waits for an async cleanup before it settles', async () => {
    const order: string[] = []
    await withFinally(
      () => order.push('operation'),
      async () => {
        await Promise.resolve()
        order.push('cleanup')
      },
    )
    order.push('settled')
    expect(order).toEqual(['operation', 'cleanup', 'settled'])
  })
})

describe('attempt', () => {
  it('settles into a result instead of throwing', async () => {
    const failure = new Error('failed')
    await expect(attempt(async () => 1)).resolves.toEqual({ ok: true, value: 1 })
    await expect(
      attempt(() => {
        throw failure
      }),
    ).resolves.toEqual({ ok: false, error: failure })
  })
})
