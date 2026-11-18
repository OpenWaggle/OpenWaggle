import { awaitWithSignal } from './await-with-signal'

export const HOST_POLL_INTERVAL_MS = 50
/**
 * A launched Host listens within about a second, and the GUI waits on nothing else (A-F14): it
 * looks every 10 ms for that first second, then every 50 ms as before.
 */
export const HOST_FAST_POLL_INTERVAL_MS = 10
export const HOST_FAST_POLL_WINDOW_MS = 1_000

/** How long to wait before looking again, `elapsedMs` into a wait for the Host. */
export function hostPollInterval(elapsedMs: number) {
  return elapsedMs < HOST_FAST_POLL_WINDOW_MS ? HOST_FAST_POLL_INTERVAL_MS : HOST_POLL_INTERVAL_MS
}

/** Polls `condition` until it holds or `timeoutMs` passed, quickly at first (A-F14). */
export async function waitForCondition(input: {
  readonly timeoutMs: number
  readonly condition: () => Promise<boolean>
  readonly dependencies: {
    readonly now: () => number
    readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  }
  readonly signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
  const startedAt = input.dependencies.now()
  const deadline = startedAt + input.timeoutMs
  while (input.dependencies.now() < deadline) {
    if (await awaitWithSignal(input.condition(), input.signal)) return true
    await awaitWithSignal(
      input.dependencies.wait(hostPollInterval(input.dependencies.now() - startedAt), input.signal),
      input.signal,
    )
  }
  return awaitWithSignal(input.condition(), input.signal)
}
