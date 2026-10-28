import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@earendil-works/pi-ai'
import { clearBedrockClients } from '@earendil-works/pi-ai/bedrock-provider'
import { BEDROCK_TEXT_FRAMES } from './bedrock-event-stream.test-utils'

/** A loopback HTTP/1.1 server that answers Bedrock Converse requests, for Pi's real transport. */

export interface RecordedRequest {
  readonly headers: IncomingHttpHeaders
  readonly body: string
  readonly connection: number
}

export interface ServerOptions {
  /** The first `rejectExpired` requests fail like AWS rejects expired STS credentials. */
  readonly rejectExpired?: number
}

function rejection(options: ServerOptions, request: number) {
  if (request <= (options.rejectExpired ?? 0)) {
    return {
      type: 'ExpiredTokenException',
      message: 'The security token included in the request is expired',
    }
  }
  return undefined
}

export async function withBedrockServer<T>(
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<T>,
  options: ServerOptions = {},
) {
  const requests: RecordedRequest[] = []
  let connections = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const connection = Number(Reflect.get(request.socket, 'testConnectionId'))
      requests.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
        connection,
      })
      const rejected = rejection(options, requests.length)
      if (rejected) {
        response.writeHead(403, {
          'content-type': 'application/json',
          'x-amzn-errortype': rejected.type,
        })
        response.end(JSON.stringify({ message: rejected.message }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' })
      response.end(BEDROCK_TEXT_FRAMES)
    })
  })
  server.on('connection', (socket) => {
    connections += 1
    Reflect.set(socket, 'testConnectionId', connections)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address: AddressInfo | string | null = server.address()
    if (address === null || typeof address === 'string') throw new Error('No TCP address')
    return await run(`http://127.0.0.1:${String(address.port)}`, requests)
  } finally {
    clearBedrockClients()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** Pi's Bedrock settings for the loopback server: no signing, HTTP/1.1, no proxy. */
export const BEDROCK_LOOPBACK_ENV = {
  AWS_BEDROCK_SKIP_AUTH: '1',
  AWS_BEDROCK_FORCE_HTTP1: '1',
  no_proxy: '127.0.0.1',
  NO_PROXY: '127.0.0.1',
}

export function userContext(text = 'hello'): Context {
  return { messages: [{ role: 'user', content: text, timestamp: 0 }] }
}
