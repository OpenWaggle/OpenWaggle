import * as Effect from 'effect/Effect'
import {
  events,
  type FakePty,
  OWNER,
  service,
  TERMINAL_ID,
} from './terminal-service-actions-test-harness'

// Observations of the terminal service through its public port and the fake PTY port, so tests
// do not read the service's internal record map.

/** Terminal keys the service reports through its public activity snapshot. */
export async function terminalKeys(): Promise<string[]> {
  const snapshot = await Effect.runPromise(service.getActivitySnapshot())
  return snapshot.summaries.map((summary) => `${summary.ownerKey}::${summary.terminalId}`)
}

/** The last output flow-control call the service made on a fake PTY port. */
export function lastFlowControl(fake: FakePty | undefined): 'pause' | 'resume' | undefined {
  if (fake === undefined) return undefined
  const calls = [
    ...fake.pauseOutput.mock.invocationCallOrder.map((order) => ({
      order,
      call: 'pause' as const,
    })),
    ...fake.resumeOutput.mock.invocationCallOrder.map((order) => ({
      order,
      call: 'resume' as const,
    })),
  ]
  return calls.sort((left, right) => left.order - right.order).at(-1)?.call
}

/** The readiness phase of the last readiness event the service emitted for the main terminal. */
export function readinessPhase() {
  const readiness = events.findLast(
    (payload) =>
      payload.ownerKey === OWNER &&
      payload.terminalId === TERMINAL_ID &&
      payload.event.type === 'readiness',
  )?.event
  return readiness?.type === 'readiness' ? readiness.readiness.phase : undefined
}

/** Whether the public activity snapshot reports a pending Project Action for the terminal. */
export async function projectActionPending(key: string): Promise<boolean | undefined> {
  const snapshot = await Effect.runPromise(service.getActivitySnapshot())
  return snapshot.summaries.find((summary) => `${summary.ownerKey}::${summary.terminalId}` === key)
    ?.projectActionPending
}
