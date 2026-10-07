import {
  isJsonRpcRequest,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type McpWireTransport,
  WireTransportEvents,
} from '../mcp-wire'

export const INITIALIZE_RESULT = {
  protocolVersion: '2025-11-25',
  capabilities: { tools: {} },
  serverInfo: { name: 'fake', version: '1' },
}

type Responder = (request: JsonRpcRequest) => unknown

/**
 * An MCP server on the far side of a transport: records what reaches it and answers requests with
 * `respond` (initialize is answered by default). `undefined` from `respond` leaves a request open.
 */
export class FakeUpstream extends WireTransportEvents implements McpWireTransport {
  readonly received: JsonRpcMessage[] = []
  started = 0
  closed = false
  protocolVersion: string | undefined
  failStart: Error | undefined
  failSend: Error | undefined

  constructor(private readonly respond: Responder = () => undefined) {
    super()
  }

  async start() {
    this.started += 1
    if (this.failStart) throw this.failStart
  }

  async send(message: JsonRpcMessage) {
    if (this.failSend) throw this.failSend
    this.received.push(message)
    if (!isJsonRpcRequest(message)) return
    const result = message.method === 'initialize' ? INITIALIZE_RESULT : this.respond(message)
    if (result !== undefined) {
      queueMicrotask(() => this.emitMessage({ jsonrpc: '2.0', id: message.id, result }))
    }
  }

  async close() {
    this.closed = true
    this.emitClose()
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version
  }

  /** The server sends a message to the client side. */
  push(message: JsonRpcMessage) {
    this.emitMessage(message)
  }

  /** The server process died. */
  crash() {
    this.emitClose()
  }

  methods() {
    return this.received.flatMap((message) => ('method' in message ? [message.method] : []))
  }

  requests(method: string) {
    return this.received.filter(
      (message): message is JsonRpcRequest =>
        isJsonRpcRequest(message) && message.method === method,
    )
  }
}

/** The client side of a transport: collects what the layer delivers to one lease. */
export function collect(transport: McpWireTransport) {
  const messages: JsonRpcMessage[] = []
  let closed = false
  transport.onMessage((message) => messages.push(message))
  transport.onClose(() => {
    closed = true
  })
  return {
    messages,
    get closed() {
      return closed
    },
  }
}

export function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

export function initializeRequest(
  id: number,
  capabilities: Record<string, unknown> = {},
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities,
      clientInfo: { name: 'pi', version: '1' },
    },
  }
}
