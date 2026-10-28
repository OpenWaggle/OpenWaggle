import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { McpUpstream } from '../../../mcp/pool/mcp-connection-pool-api'

const resolved = vi.hoisted(() => ({ values: [] as string[] }))

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
      (_sessionId: string, _spec: { readonly open: () => Promise<McpUpstream> }) =>
        fromPartial({}),
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
