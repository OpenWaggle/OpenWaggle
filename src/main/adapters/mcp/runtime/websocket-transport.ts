import type { JSONRPCMessage, Transport, TransportSendOptions } from '@modelcontextprotocol/client'
import { parseJSONRPCMessage } from '@modelcontextprotocol/client'
import WebSocket from 'ws'
import { MCP_MAX_MESSAGE_BYTES } from './mcp-message-limit'
import { normalizeMcpAllowedHosts } from './mcp-network-hosts'
import {
  createPinnedMcpLookup,
  type HostnameResolver,
  validateMcpNetworkTarget,
} from './secure-fetch'

const NORMAL_WEBSOCKET_CLOSE_CODE = 1_000
const WEBSOCKET_CLOSE_TIMEOUT_MS = 1_000

export class LegacyWebSocketClientTransport implements Transport {
  readonly url: URL
  readonly headers: Readonly<Record<string, string>>
  readonly allowedHosts: ReadonlySet<string>
  readonly allowInsecurePrivateNetwork: boolean
  readonly allowPlainWebSocket: boolean
  private readonly resolveHostname: HostnameResolver | undefined
  private socket: WebSocket | null = null

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(input: {
    readonly url: URL
    readonly headers: Readonly<Record<string, string>>
    readonly allowedDomains?: readonly string[]
    readonly allowInsecurePrivateNetwork?: boolean
    /** Plain `ws:` to any host: only for an endpoint the user configured, as Pi allows `http:`. */
    readonly allowPlainWebSocket?: boolean
    readonly resolveHostname?: HostnameResolver
  }) {
    this.url = input.url
    this.headers = input.headers
    this.allowedHosts = normalizeMcpAllowedHosts([
      input.url.hostname,
      ...(input.allowedDomains ?? []),
    ])
    this.allowInsecurePrivateNetwork = input.allowInsecurePrivateNetwork === true
    this.allowPlainWebSocket = input.allowPlainWebSocket === true
    this.resolveHostname = input.resolveHostname
  }

  async start() {
    if (this.socket) throw new Error('Legacy MCP WebSocket transport is already started.')
    const target = await validateMcpNetworkTarget({
      url: this.url,
      allowedHosts: this.allowedHosts,
      allowInsecurePrivateNetwork: this.allowInsecurePrivateNetwork,
      allowPlainHttp: this.allowPlainWebSocket,
      websocket: true,
      ...(this.resolveHostname ? { resolveHostname: this.resolveHostname } : {}),
    })

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url, {
        headers: { ...this.headers, Host: this.url.host },
        followRedirects: false,
        lookup: createPinnedMcpLookup(target),
        maxPayload: MCP_MAX_MESSAGE_BYTES,
        rejectUnauthorized: true,
      })
      this.socket = socket
      const rejectStart = (error: Error) => reject(error)
      socket.once('open', () => {
        socket.off('error', rejectStart)
        resolve()
      })
      socket.once('error', rejectStart)
      socket.on('error', (error) => this.onerror?.(error))
      socket.on('close', () => {
        this.socket = null
        this.onclose?.()
      })
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          this.onerror?.(new Error('Legacy MCP WebSocket sent an unsupported binary message.'))
          return
        }
        try {
          // The SDK parses a decoded value, not text.
          const decoded: unknown = JSON.parse(data.toString('utf8'))
          this.onmessage?.(parseJSONRPCMessage(decoded))
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions) {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Legacy MCP WebSocket transport is not connected.')
    }
    await new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(message), (error) => (error ? reject(error) : resolve()))
    })
  }

  async close() {
    const socket = this.socket
    this.socket = null
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close(NORMAL_WEBSOCKET_CLOSE_CODE, 'OpenWaggle MCP session closed')
      setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
        resolve()
      }, WEBSOCKET_CLOSE_TIMEOUT_MS).unref()
    })
  }
}
