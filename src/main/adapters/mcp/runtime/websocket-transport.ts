import type { JSONRPCMessage, Transport, TransportSendOptions } from '@modelcontextprotocol/client'
import { parseJSONRPCMessage } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'
import WebSocket from 'ws'
import { createPinnedMcpLookup, validateMcpNetworkTarget } from './secure-fetch'

const NORMAL_WEBSOCKET_CLOSE_CODE = 1_000
const WEBSOCKET_CLOSE_TIMEOUT_MS = 1_000

export class LegacyWebSocketClientTransport implements Transport {
  readonly url: URL
  readonly headers: Readonly<Record<string, string>>
  readonly allowedHosts: ReadonlySet<string>
  readonly allowInsecurePrivateNetwork: boolean
  private socket: WebSocket | null = null

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(input: {
    readonly url: URL
    readonly headers: Readonly<Record<string, string>>
    readonly allowedDomains?: readonly string[]
    readonly allowInsecurePrivateNetwork?: boolean
  }) {
    this.url = input.url
    this.headers = input.headers
    this.allowedHosts = new Set(
      [input.url.hostname, ...(input.allowedDomains ?? [])].map((host) => host.toLowerCase()),
    )
    this.allowInsecurePrivateNetwork = input.allowInsecurePrivateNetwork === true
  }

  async start() {
    if (this.socket) throw new Error('Legacy MCP WebSocket transport is already started.')
    const target = await validateMcpNetworkTarget({
      url: this.url,
      allowedHosts: this.allowedHosts,
      allowInsecurePrivateNetwork: this.allowInsecurePrivateNetwork,
      websocket: true,
    })

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url, {
        headers: { ...this.headers, Host: this.url.host },
        followRedirects: false,
        lookup: createPinnedMcpLookup(target),
        maxPayload: MCP_CONFIG.MAX_RESULT_BYTES,
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
          this.onmessage?.(parseJSONRPCMessage(data.toString('utf8')))
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
