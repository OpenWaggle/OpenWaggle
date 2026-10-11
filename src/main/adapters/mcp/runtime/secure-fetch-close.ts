import type { Dispatcher1Wrapper } from 'undici'

/**
 * How long closing waits for requests in flight before it ends them: a connect to a host that
 * never answers would otherwise hold the close for undici's connect timeout (10 s).
 */
export const MCP_FETCH_CLOSE_GRACE_MS = 1_000

/** Closes the dispatchers; requests still in flight after the grace are aborted. */
export async function closeWithinGrace(
  dispatchers: readonly Dispatcher1Wrapper[],
  inFlight: Set<AbortController>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const closed = Promise.all(dispatchers.map((dispatcher) => dispatcher.close())).then(() => true)
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), MCP_FETCH_CLOSE_GRACE_MS)
  })
  const done = await Promise.race([closed, late])
  clearTimeout(timer)
  if (done) return
  for (const controller of inFlight) controller.abort(new Error('The MCP connection was closed.'))
  await Promise.all(dispatchers.map((dispatcher) => dispatcher.destroy()))
}
