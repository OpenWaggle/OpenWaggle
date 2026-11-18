import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { McpSdkTransportAdapter } from '../mcp-sdk-transport-adapter'
import { collect } from './fake-upstream'

class FakeSdkTransport implements Transport {
  sent: JSONRPCMessage[] = []
  closed = false
  protocolVersion: string | undefined
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  async start() {}

  async send(message: JSONRPCMessage) {
    this.sent.push(message)
  }

  async close() {
    this.closed = true
    this.onclose?.()
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version
  }
}

describe('MCP SDK transport adapter', () => {
  it('passes messages both ways and reports close once', async () => {
    const sdk = new FakeSdkTransport()
    const adapter = new McpSdkTransportAdapter(sdk)
    const client = collect(adapter)
    let closes = 0
    adapter.onClose(() => {
      closes += 1
    })

    await adapter.start()
    await adapter.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    sdk.onmessage?.({ jsonrpc: '2.0', id: 1, result: { tools: [] } })
    adapter.setProtocolVersion('2024-11-05')
    await adapter.close()

    expect(sdk.sent).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
    expect(client.messages).toEqual([{ jsonrpc: '2.0', id: 1, result: { tools: [] } }])
    expect(sdk.protocolVersion).toBe('2024-11-05')
    expect(closes).toBe(1)
  })
})
