import type { IncomingMessage } from 'node:http'

/**
 * The parts of a Node request the MCP Node adapter reads. Node types `method` and `url` as possibly
 * undefined, which the adapter's exact optional fields do not accept, so absent ones are left out.
 */
export function mcpNodeRequestLike(request: IncomingMessage) {
  return {
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.url === undefined ? {} : { url: request.url }),
    headers: request.headers,
    [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
  }
}
