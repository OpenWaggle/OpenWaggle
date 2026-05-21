import { describe, expect, it } from 'vitest'
import { createDeferred } from '../deferred'

describe('createDeferred', () => {
  it('exposes a promise that can be resolved externally', async () => {
    const deferred = createDeferred()
    deferred.resolve()

    await expect(deferred.promise).resolves.toBeUndefined()
  })

  it('exposes a promise that can be rejected externally', async () => {
    const deferred = createDeferred()
    const error = new Error('boom')
    deferred.reject(error)

    await expect(deferred.promise).rejects.toBe(error)
  })
})
