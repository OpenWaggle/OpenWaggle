import {
  type JSONRPCMessage,
  parseJSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client'
import { type JsonRpcMessage, type McpWireTransport, WireTransportEvents } from './mcp-wire'

/**
 * Presents an MCP SDK transport (the legacy SSE and WebSocket compatibility transports) as the
 * pi-mcp transport shape the layer works with.
 */
export class McpSdkTransportAdapter extends WireTransportEvents implements McpWireTransport {
  private readonly transport: Transport

  constructor(transport: Transport) {
    super()
    this.transport = transport
    transport.onmessage = (message: JSONRPCMessage) => this.emitMessage(toWireMessage(message))
    transport.onerror = (error) => this.emitError(error)
    transport.onclose = () => this.emitClose()
  }

  start() {
    return this.transport.start()
  }

  send(message: JsonRpcMessage) {
    return this.transport.send(parseJSONRPCMessage(message))
  }

  async close() {
    await this.transport.close()
    this.emitClose()
  }

  setProtocolVersion(version: string) {
    this.transport.setProtocolVersion?.(version)
  }
}

function toWireMessage(message: JSONRPCMessage) {
  if ('method' in message) {
    return (
      'id' in message
        ? { jsonrpc: '2.0', id: message.id, method: message.method, params: message.params }
        : { jsonrpc: '2.0', method: message.method, params: message.params }
    ) satisfies JsonRpcMessage
  }
  if ('error' in message) {
    return { jsonrpc: '2.0', id: message.id ?? '', error: message.error } satisfies JsonRpcMessage
  }
  return { jsonrpc: '2.0', id: message.id, result: message.result } satisfies JsonRpcMessage
}
