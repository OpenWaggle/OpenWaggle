import * as Effect from 'effect/Effect'
import { yieldToEventLoop } from '../utils/event-loop-slice'
import { hostBackgroundGate } from './host-background-gate'

/**
 * Where a background pass starts: once a client has been attached a moment (A-F9) and the
 * clients' requests are quiet (W12).
 */
export const awaitHostBackgroundTurn = Effect.promise(async () => {
  await hostBackgroundGate.whenOpen()
  await hostBackgroundGate.whenForegroundQuiet()
})

/**
 * Between the slices of a background pass, outside any transaction: lets pending I/O run, then
 * waits while clients' requests are in flight, so they never queue behind slice after slice.
 */
export const yieldToHostForeground = Effect.zipRight(
  yieldToEventLoop,
  Effect.promise(() => hostBackgroundGate.whenForegroundQuiet()),
)
