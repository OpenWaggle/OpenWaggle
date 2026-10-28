import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { deferredMcpSecret } from '../../../mcp/config/mcp-deferred-secrets'
import { mcpConnectionFingerprint } from '../../../mcp/pool/mcp-server-identity'

const mocks = vi.hoisted(() => ({
  open: vi.fn((_input: { readonly entry: { readonly config: unknown } }) => ({
    transport: {},
    stderrTail: () => '',
  })),
  resolve: vi.fn(async (name: string) => `value-of-${name}`),
}))

vi.mock('../pi-mcp-upstream', () => ({
  openPiMcpUpstream: mocks.open,
  preparePiMcpUpstream: async () => undefined,
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/encrypted-mcp-secret-vault-service')>()),
  resolveMcpVaultSecret: mocks.resolve,
}))

const { openWaggleMcpTransport } = await import('../openwaggle-mcp-extensions')

describe('connecting a server that was off when the Run started', () => {
  it('reads its vault secrets when Pi connects it', async () => {
    const lease = vi.fn((_sessionId: string, _spec: { readonly open: () => unknown }) =>
      fromPartial({}),
    )
    const transport = openWaggleMcpTransport(
      { sessionId: 's1', projectPath: null, pool: fromPartial({ lease }) },
      { transports: new Map() },
    )

    transport(
      {
        name: 'off',
        config: { command: 'off-mcp', env: { TOKEN: deferredMcpSecret('OFF_TOKEN') } },
        source: '/home/.openwaggle/mcp.json',
        scope: 'global',
      },
      '/work',
      undefined,
    )
    expect(mocks.resolve).not.toHaveBeenCalled()
    await lease.mock.calls[0]?.[1].open()

    expect(mocks.resolve).toHaveBeenCalledWith('OFF_TOKEN')
    expect(mocks.open.mock.calls[0]?.[0].entry.config).toEqual({
      command: 'off-mcp',
      env: { TOKEN: 'value-of-OFF_TOKEN' },
    })
  })

  it('names the connection by the secret stamps, not by the values or the deferred markers', () => {
    const lease = vi.fn((_sessionId: string, _spec: { readonly fingerprint: string }) =>
      fromPartial({}),
    )
    const stamped = { command: 'off-mcp', env: { TOKEN: 'vault-secret:OFF_TOKEN@1' } }
    const entry = (token: string) => ({
      name: 'off',
      config: { command: 'off-mcp', env: { TOKEN: token } },
      source: '/home/.openwaggle/mcp.json',
      scope: 'global' as const,
    })
    const transport = openWaggleMcpTransport(
      { sessionId: 's1', projectPath: null, pool: fromPartial({ lease }) },
      { transports: new Map(), connectionConfigs: new Map([['off', stamped]]) },
    )

    transport(entry(deferredMcpSecret('OFF_TOKEN')), '/work', undefined)
    transport(entry('value-of-OFF_TOKEN'), '/work', undefined)

    const [first, second] = lease.mock.calls.map(([, spec]) => spec.fingerprint)
    expect(first).toBe(second)
    expect(first).toBe(
      mcpConnectionFingerprint({ config: stamped, transport: 'stdio', cwd: '/work' }),
    )
  })
})
