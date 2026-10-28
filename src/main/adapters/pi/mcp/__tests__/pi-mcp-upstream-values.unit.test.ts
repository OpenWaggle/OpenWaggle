import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { McpUpstream } from '../../../mcp/pool/mcp-connection-pool-api'

const resolved = vi.hoisted(() => {
  const values: string[] = []
  return { values }
})

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...original,
    resolveConfigValueOrThrow: (value: string, ...rest: [string, Record<string, string>]) => {
      resolved.values.push(value)
      return original.resolveConfigValueOrThrow(value, ...rest)
    },
  }
})

const { openWaggleMcpTransport } = await import('../openwaggle-mcp-extensions')

describe('a stdio server’s values (review R5 P2-1)', () => {
  it('are resolved once per spawn, so a `!command` value runs once', async () => {
    const lease = vi.fn(
      (_sessionId: string, _spec: { readonly open: () => Promise<McpUpstream> }) => fromPartial({}),
    )
    const transport = openWaggleMcpTransport(
      { sessionId: 's1', projectPath: null, pool: fromPartial({ lease }) },
      { transports: new Map() },
    )
    transport(
      {
        name: 'tokens',
        config: { command: 'node', args: ['server.js'], env: { TOKEN: '!printf token' } },
        source: 'test',
        scope: 'global',
      },
      process.cwd(),
      undefined,
    )

    const upstream = await lease.mock.calls[0]?.[1].open()

    expect(resolved.values).toEqual(['!printf token'])
    await upstream?.close?.()
  })
})

describe('a Session lease of a slow-to-fill server (review R5 P3-5)', () => {
  it('waits for another Session’s catalog fill at most a third of the server timeout', () => {
    const lease = vi.fn((_sessionId: string, _spec: { readonly catalogFillWaitMs?: number }) =>
      fromPartial({}),
    )
    const transport = openWaggleMcpTransport(
      { sessionId: 's1', projectPath: null, pool: fromPartial({ lease }) },
      { transports: new Map() },
    )
    transport(
      {
        name: 'slow',
        config: { command: 'slow-mcp', timeout: 9 },
        source: 'test',
        scope: 'global',
      },
      process.cwd(),
      undefined,
    )

    expect(lease.mock.calls[0]?.[1].catalogFillWaitMs).toBe(3_000)
  })
})
