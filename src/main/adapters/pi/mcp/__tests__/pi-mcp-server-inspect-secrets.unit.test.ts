import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const loads: unknown[] = []
  const opened: unknown[] = []
  return { loads, opened, resolve: vi.fn(async (name: string) => `value-of-${name}`) }
})

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', async () => {
  const { deferredMcpSecret } = await import('../../../mcp/config/mcp-deferred-secrets')
  return {
    loadMcpRuntimeConfig: async (input: unknown) => {
      mocks.loads.push(input)
      return {
        loaded: {
          servers: [
            {
              name: 'api',
              config: { command: 'api-mcp', env: { TOKEN: deferredMcpSecret('API_TOKEN') } },
              source: '/home/user/.openwaggle/mcp.json',
              scope: 'global',
            },
          ],
          errors: [],
        },
        transports: new Map(),
        unavailable: new Map(),
      }
    },
  }
})
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/encrypted-mcp-secret-vault-service')>()),
  resolveMcpVaultSecret: mocks.resolve,
}))
vi.mock('../pi-mcp-upstream', () => ({
  openPiMcpUpstream: (input: unknown) => {
    mocks.opened.push(input)
    throw new Error('not started in this test')
  },
}))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')
const { deferredMcpVaultSecret } = await import('../../../mcp/encrypted-mcp-secret-vault-service')

describe('Check connection', () => {
  it("loads only the server it checks, and reads that server's secrets when it connects", async () => {
    await inspectMcpServer(
      { projectPath: null, name: 'api' },
      { homeDir: '/home/user', piAgentDir: '/home/user/.pi/agent' },
    )

    expect(mocks.loads.at(-1)).toMatchObject({
      resolveSecret: deferredMcpVaultSecret,
      serverAllowlist: ['api'],
    })
    expect(mocks.resolve).toHaveBeenCalledWith('API_TOKEN')
    expect(mocks.opened.at(-1)).toMatchObject({
      entry: { config: { env: { TOKEN: 'value-of-API_TOKEN' } } },
    })
  })
})
