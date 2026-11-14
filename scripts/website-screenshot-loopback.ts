import type http from 'node:http'
import type { AddressInfo } from 'node:net'

/** The only interface the screenshot fixture servers bind. */
export const LOOPBACK_HOST = '127.0.0.1'

/**
 * Listens on `port` (0 picks a free one) and resolves with the bound port. A bind failure
 * rejects instead of crashing the process with an unhandled 'error' event, so the caller's
 * `finally` still releases the scratch profile; a server left without a port is closed.
 */
export async function listenOnLoopback(server: http.Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, LOOPBACK_HOST)
  })
  const address: AddressInfo | string | null = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Fixture server has no port.')
  }
  return address.port
}
