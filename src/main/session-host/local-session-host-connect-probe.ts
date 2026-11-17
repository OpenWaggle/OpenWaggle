import net from 'node:net'

/** How long a bare connection attempt may take before the endpoint counts as not listening. */
const CONNECT_PROBE_TIMEOUT_MS = 250

/**
 * Connects and closes: whether anything is listening at `endpoint` right now. This answers
 * endpoint liveness only; a full probe handshake answers whether a compatible Host lives there.
 */
export function canConnectToLocalSessionHost(endpoint: string, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    signal?.throwIfAborted()
    const socket = net.createConnection(endpoint)
    const abort = () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(false)
    }
    const settle = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      settle()
      socket.destroy()
      resolve(false)
    }, CONNECT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      settle()
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      settle()
      resolve(false)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}
