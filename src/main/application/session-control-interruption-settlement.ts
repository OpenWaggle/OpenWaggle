import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import {
  type AgentRunInterruptionInput,
  AgentRunInterruptionService,
} from '../ports/agent-run-interruption-service'

/**
 * How long an interrupt waits for the aborted Run to settle before it answers. The abort is
 * already delivered, and the settlement still reaches every client as a Session state event. A
 * Run whose teardown hangs must not hold the reply past the client's response timeout, where it
 * reads as an unreachable Session Host.
 */
export const RUN_INTERRUPTION_SETTLEMENT_WAIT_MS = 5_000

/** Abort the exact Run without waiting for it to settle. */
export function requestRunInterruption(target: AgentRunInterruptionInput) {
  return AgentRunInterruptionService.pipe(
    Effect.flatMap((service) => service.requestInterrupt(target)),
  )
}

/** Abort the exact Run, then wait a bounded time for it to settle. */
export function interruptRunWithBoundedSettlement(target: AgentRunInterruptionInput) {
  return AgentRunInterruptionService.pipe(
    Effect.flatMap((service) => service.interrupt(target)),
    // Session Control dispatch runs interrupts uninterruptibly; only this wait may be cut short.
    Effect.interruptible,
    Effect.timeoutTo({
      duration: Duration.millis(RUN_INTERRUPTION_SETTLEMENT_WAIT_MS),
      onSuccess: (result) => result,
      // A Run that is still settling was live, so its abort was accepted.
      onTimeout: () => ({ accepted: true }) as const,
    }),
  )
}
