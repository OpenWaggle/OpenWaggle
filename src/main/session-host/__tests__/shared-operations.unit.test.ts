import { describe, expect, it, vi } from 'vitest'
import { makeSharedOperations } from '../shared-operations'

function deferred() {
  return Promise.withResolvers<void>()
}

describe('shared operations', () => {
  it('runs one operation for callers that arrive while it runs', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const done = deferred()
    const operation = vi.fn(() => done.promise)

    const first = shared(owner, 'host', undefined, operation)
    const second = shared(owner, 'host', undefined, operation)
    done.resolve()
    await Promise.all([first, second])

    expect(operation).toHaveBeenCalledOnce()
  })

  it('runs again once the previous operation settled', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const operation = vi.fn(async () => undefined)

    await shared(owner, 'host', undefined, operation)
    await shared(owner, 'host', undefined, operation)

    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('keeps separate operations for separate keys and owners', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const operation = vi.fn(async () => undefined)

    await Promise.all([
      shared(owner, 'host-a', undefined, operation),
      shared(owner, 'host-b', undefined, operation),
      shared({}, 'host-a', undefined, operation),
    ])

    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('gives every caller the operation failure', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const operation = async () => {
      throw new Error('launch failed')
    }

    const results = await Promise.allSettled([
      shared(owner, 'host', undefined, operation),
      shared(owner, 'host', undefined, operation),
    ])

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  })

  it('stops only the aborting caller while another still waits', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const done = deferred()
    let operationSignal: AbortSignal | undefined
    const operation = (signal: AbortSignal) => {
      operationSignal = signal
      return done.promise
    }
    const leaving = new AbortController()

    const first = shared(owner, 'host', leaving.signal, operation)
    const second = shared(owner, 'host', new AbortController().signal, operation)
    await Promise.resolve()
    leaving.abort(new Error('window closed'))

    await expect(first).rejects.toThrow('window closed')
    expect(operationSignal?.aborted).toBe(false)
    done.resolve()
    await expect(second).resolves.toBeUndefined()
  })

  it('aborts the operation once every waiting caller has aborted', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    let operationSignal: AbortSignal | undefined
    const operation = (signal: AbortSignal) => {
      operationSignal = signal
      return new Promise<void>(() => undefined)
    }
    const first = new AbortController()
    const second = new AbortController()

    const waits = [
      shared(owner, 'host', first.signal, operation),
      shared(owner, 'host', second.signal, operation),
    ]
    await Promise.resolve()
    first.abort(new Error('first'))
    second.abort(new Error('second'))
    await Promise.allSettled(waits)

    expect(operationSignal?.aborted).toBe(true)
  })
})
