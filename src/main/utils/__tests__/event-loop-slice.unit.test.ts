import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEventLoopSlicer, yieldToEventLoop } from '../event-loop-slice'

function busyWait(milliseconds: number) {
  const until = performance.now() + milliseconds
  while (performance.now() < until) {
    // Synchronous work, like a SQLite statement.
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('event loop slices', () => {
  it('lets pending I/O callbacks run once a slice used its budget', async () => {
    const slice = makeEventLoopSlicer(5)
    const order: string[] = []
    const work = Effect.gen(function* () {
      setImmediate(() => order.push('io'))
      busyWait(1)
      yield* slice
      order.push('before budget')
      busyWait(10)
      yield* slice
      order.push('after budget')
    })

    await Effect.runPromise(work)

    expect(order).toEqual(['before budget', 'io', 'after budget'])
  })

  it('still yields while a test fakes the timers', async () => {
    vi.useFakeTimers()
    let ran = false
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* yieldToEventLoop
        ran = true
      }),
    )
    expect(ran).toBe(true)
  })
})
