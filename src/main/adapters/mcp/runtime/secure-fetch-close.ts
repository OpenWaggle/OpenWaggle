import type { Dispatcher1Wrapper } from 'undici'

/**
 * How long closing waits for requests in flight, bodies included, before it ends them: a connect
 * to a host that never answers, or an event stream that stays open, would otherwise hold it.
 */
export const MCP_FETCH_CLOSE_GRACE_MS = 1_000

function closedError() {
  return new Error('The MCP connection was closed.')
}

/** The response with a body that reports when it ended, failed, or was cancelled. */
function withSettledBody(response: Response, body: ReadableStream<Uint8Array>, done: () => void) {
  const reader = body.getReader()
  const tracked = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
          done()
          return
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
        done()
      }
    },
    async cancel(reason) {
      done()
      await reader.cancel(reason)
    },
  })
  const wrapped = new Response(tracked, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  if (response.url) Object.defineProperty(wrapped, 'url', { value: response.url })
  return wrapped
}

/**
 * The requests of one secure MCP fetch, each until its body is read, fails or is cancelled, so
 * closing can wait for them a bounded time and then end them. A closed fetch sends nothing more.
 */
export class McpFetchRequests {
  private readonly pending = new Map<AbortController, Promise<void>>()
  private closing = false

  assertOpen() {
    if (this.closing) throw closedError()
  }

  async send(init: RequestInit, request: (signal: AbortSignal) => Promise<Response>) {
    this.assertOpen()
    const controller = new AbortController()
    let settle = () => {}
    this.pending.set(controller, new Promise<void>((resolve) => (settle = resolve)))
    const done = () => {
      this.pending.delete(controller)
      settle()
    }
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal
    try {
      const response = await request(signal)
      if (!response.body) {
        done()
        return response
      }
      return withSettledBody(response, response.body, done)
    } catch (error) {
      done()
      throw error
    }
  }

  /** Refuses new requests, waits up to the grace for these, ends the rest, then the dispatchers. */
  async close(dispatchers: readonly Dispatcher1Wrapper[]) {
    this.closing = true
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.all(this.pending.values()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, MCP_FETCH_CLOSE_GRACE_MS)
      }),
    ])
    clearTimeout(timer)
    for (const controller of this.pending.keys()) controller.abort(closedError())
    // Not close() first: undici's close forgets its clients, so destroy() would find none.
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.destroy()))
  }
}
