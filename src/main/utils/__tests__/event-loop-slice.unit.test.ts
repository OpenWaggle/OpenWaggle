import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEventLoopSlicer, yieldToEventLoop } from '../event-loop-slice'

afterEach(() => {
  vi.useRealTimers()
})

describe('event loop slices', () => {
  it('lets pending I/O callbacks run once a slice used its budget', async () => {
    let clock = 0
    const slice = makeEventLoopSlicer(5, () => clock)
    const order: string[] = []
    const work = Effect.gen(function* () {
      setImmediate(() => order.push('io'))
      // Synchronous work, like SQLite statements, that has not used the budget yet.
      clock = 4
      yield* slice
      order.push('before budget')
      clock = 9
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
