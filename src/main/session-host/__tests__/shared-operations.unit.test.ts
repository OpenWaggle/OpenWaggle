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

  it('starts afresh for a caller that arrives after every waiter aborted', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const signals: AbortSignal[] = []
    const operation = (signal: AbortSignal) => {
      signals.push(signal)
      if (signals.length > 1) return Promise.resolve()
      // The aborted run settles only later, with its abort reason.
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => setTimeout(() => reject(signal.reason), 10))
      })
    }
    const leaving = new AbortController()
    const aborted = shared(owner, 'host', leaving.signal, operation)
    await Promise.resolve()
    leaving.abort(new Error('window closed'))
    await expect(aborted).rejects.toThrow('window closed')

    await expect(
      shared(owner, 'host', new AbortController().signal, operation),
    ).resolves.toBeUndefined()
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('keeps a fresh run when the aborted run it replaced settles', async () => {
    const shared = makeSharedOperations<object>()
    const owner = {}
    const fresh = deferred()
    let runs = 0
    const operation = (signal: AbortSignal) => {
      runs += 1
      if (runs > 1) return fresh.promise
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => setTimeout(() => reject(signal.reason), 10))
      })
    }
    const leaving = new AbortController()
    const aborted = shared(owner, 'host', leaving.signal, operation)
    await Promise.resolve()
    leaving.abort(new Error('window closed'))
    await expect(aborted).rejects.toThrow('window closed')
    const second = shared(owner, 'host', undefined, operation)
    // The aborted run settles while the fresh one still runs; a third caller joins the fresh one.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const third = shared(owner, 'host', undefined, operation)
    fresh.resolve()

    await Promise.all([second, third])
    expect(runs).toBe(2)
  })
})
