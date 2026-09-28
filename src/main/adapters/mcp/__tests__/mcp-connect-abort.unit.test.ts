import { Client, type Transport } from '@modelcontextprotocol/client'
import type { McpTurnSnapshotServer } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { connectUnlessAborted } from '../runtime/connect-abort'
import { getMcpProtocolOptions } from '../runtime/protocol-negotiation'
import { server, snapshot } from './mcp-runtime-test-utils'

const connectMocks = vi.hoisted(() => {
  const signals: (AbortSignal | undefined)[] = []
  return { signals }
})

vi.mock('../runtime/connect-abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/connect-abort')>()
  return {
    connectUnlessAborted: (...args: Parameters<typeof actual.connectUnlessAborted>) => {
      connectMocks.signals.push(args[2])
      return actual.connectUnlessAborted(...args)
    },
  }
})

const PROMPT_MS = 1_000
const ABORT_AFTER_MS = 50

/** A transport to a server that never answers, which records when it is closed. */
class SilentTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: Transport['onmessage']
  closed = false
  async start() {}
  async send() {}
  async close() {
    this.closed = true
    this.onclose?.()
  }
}

function client(definition: McpTurnSnapshotServer['definition']) {
  return new Client(
    { name: 'test', version: '1' },
    { capabilities: {}, ...getMcpProtocolOptions(server({ definition })) },
  )
}

async function abortWhileConnecting(definition: McpTurnSnapshotServer['definition']) {
  const transport = new SilentTransport()
  const abort = new AbortController()
  const connecting = connectUnlessAborted(client(definition), transport, abort.signal)
  await new Promise((resolve) => setTimeout(resolve, ABORT_AFTER_MS))
  const abortedAt = Date.now()
  abort.abort()
  const error = await connecting.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  return { error, settledAfterMs: Date.now() - abortedAt, transport }
}

describe('connecting a real MCP client that can be aborted', () => {
  it('stops a legacy handshake at once', async () => {
    const outcome = await abortWhileConnecting({ command: 'docs-mcp', compatibility: 'legacy-sse' })

    expect(outcome.error).toBeInstanceOf(Error)
    expect(outcome.settledAfterMs).toBeLessThan(PROMPT_MS)
    expect(outcome.transport.closed).toBe(true)
  })

  it('stops the version-negotiation probe, before the transport belongs to the client', async () => {
    const outcome = await abortWhileConnecting({ command: 'docs-mcp' })

    expect(outcome.error).toBeInstanceOf(Error)
    expect(outcome.settledAfterMs).toBeLessThan(PROMPT_MS)
    expect(outcome.transport.closed).toBe(true)
  })

  it('does not start a connect that was aborted before it began', async () => {
    const transport = new SilentTransport()
    const abort = new AbortController()
    abort.abort()

    await expect(
      connectUnlessAborted(client({ command: 'docs-mcp' }), transport, abort.signal),
    ).rejects.toThrow('cancelled before it started')
    expect(transport.closed).toBe(true)
  })

  it('passes the slot signal from the connection factory to the connect', async () => {
    const { createFirstPartyMcpConnectionFactory } = await import(
      '../runtime/sdk-client-connection'
    )
    const connect = createFirstPartyMcpConnectionFactory({
      clientVersion: '0.0.0-test',
      resolveSecret: async () => '',
    })
    const abort = new AbortController()
    abort.abort()
    const target = server({ definition: { url: 'https://docs.example.com/mcp' } })

    await expect(
      connect({ snapshot: snapshot({ servers: [target] }), server: target, signal: abort.signal }),
    ).rejects.toThrow('cancelled before it started')
    expect(connectMocks.signals.at(-1)).toBe(abort.signal)
  })
})
