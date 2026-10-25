import { clearImmediate, setImmediate } from 'node:timers'
import * as Effect from 'effect/Effect'

/**
 * The longest synchronous stretch a bulk Host write runs before it lets the event loop run.
 * better-sqlite3 runs every statement on the main thread, and Effect resumes fibers through
 * microtasks, so a long chain of statements never gave sockets or timers a turn (#357).
 */
export const EVENT_LOOP_SLICE_BUDGET_MS = 20

/**
 * Returns to the event loop, so pending I/O and timers run. It uses `node:timers` rather than
 * the global, which test fake timers replace. Inside a SQL transaction this is safe: other
 * fibers' statements wait for the connection until the transaction ends.
 */
export const yieldToEventLoop = Effect.async<void>((resume) => {
  const handle = setImmediate(() => resume(Effect.void))
  return Effect.sync(() => clearImmediate(handle))
})

/** A yield point that only yields once the current slice ran for `budgetMs` or longer. */
export function makeEventLoopSlicer(
  budgetMs = EVENT_LOOP_SLICE_BUDGET_MS,
  now: () => number = () => performance.now(),
) {
  let sliceStartedAt = now()
  return Effect.suspend(() => {
    if (now() - sliceStartedAt < budgetMs) return Effect.void
    return Effect.tap(yieldToEventLoop, () =>
      Effect.sync(() => {
        sliceStartedAt = now()
      }),
    )
  })
}
