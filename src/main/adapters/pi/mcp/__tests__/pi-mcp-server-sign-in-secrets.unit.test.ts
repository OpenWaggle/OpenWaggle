import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const resolvers: ((name: string) => Promise<string>)[] = []
  return {
    resolvers,
    // The keychain is never asked, and the vault is never read, to sign out.
    vault: vi.fn(async () => {
      throw new Error('the vault was read')
    }),
    remove: vi.fn(),
  }
})

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async (input: { resolveSecret: (name: string) => Promise<string> }) => {
    mocks.resolvers.push(input.resolveSecret)
    // The server's header names a secret that is not saved.
    const authorization = await input.resolveSecret('MISSING_TOKEN')
    return {
      loaded: {
        servers: [
          {
            name: 'docs',
            config: { url: 'https://docs.example.com/mcp', headers: { 'X-Key': authorization } },
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
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  deferredMcpVaultSecret: mocks.vault,
  resolveMcpVaultSecret: mocks.vault,
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({ remove: mocks.remove }),
}))

const { createPiMcpServerRuntimeService } = await import('../pi-mcp-server-runtime-service')

describe('Sign out', () => {
  it("works when the server's secret is missing, reading neither vault nor keychain", async () => {
    const pool = { closeServerIdentity: vi.fn(async () => undefined) }
    const service = createPiMcpServerRuntimeService(fromPartial(pool))

    await Effect.runPromise(service.signOut({ projectPath: null, name: 'docs' }))

    expect(mocks.vault).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith('docs', 'https://docs.example.com/mcp')
    expect(pool.closeServerIdentity).toHaveBeenCalled()
  })
})
