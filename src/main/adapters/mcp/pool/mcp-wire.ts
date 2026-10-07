/**
 * JSON-RPC and transport shapes of pi-mcp (`@earendil-works/pi-mcp`), declared structurally so
 * the MCP transport layer does not depend on the client library: Pi's `McpTransport` and these
 * interfaces are assignable to each other.
 */

export type JsonRpcId = string | number

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcErrorObject
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export interface McpWireTransport {
  start(): Promise<void>
  send(message: JsonRpcMessage): Promise<void>
  close(): Promise<void>
  onMessage(listener: (message: JsonRpcMessage) => void): () => void
  onError(listener: (error: Error) => void): () => void
  onClose(listener: () => void): () => void
  setProtocolVersion?(version: string): void
}

export const JSON_RPC_ERROR_CODES = {
  methodNotFound: -32_601,
  internalError: -32_603,
} as const

export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message && 'id' in message
}

export function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message && !('id' in message)
}

export function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return !('method' in message)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number'
}

export function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

/** Listener bookkeeping shared by the layer's transports; `onClose` listeners fire once. */
export class WireTransportEvents {
  private readonly messageListeners = new Set<(message: JsonRpcMessage) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly closeListeners = new Set<() => void>()
  private closeEmitted = false

  onMessage(listener: (message: JsonRpcMessage) => void) {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  protected emitMessage(message: JsonRpcMessage) {
    for (const listener of [...this.messageListeners]) listener(message)
  }

  protected emitError(error: unknown) {
    for (const listener of [...this.errorListeners]) listener(toError(error))
  }

  protected emitClose() {
    if (this.closeEmitted) return
    this.closeEmitted = true
    for (const listener of [...this.closeListeners]) listener()
  }
}
