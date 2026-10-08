import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const resolvers: ((name: string) => Promise<string>)[] = []
  return {
    resolvers,
    exists: vi.fn(async (name: string) => name === 'STORED'),
    resolve: vi.fn(async () => 'decrypted'),
  }
})

vi.mock('../../../mcp/config/mcp-runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/config/mcp-runtime-config')>()),
  loadMcpRuntimeConfig: async (input: { resolveSecret: (name: string) => Promise<string> }) => {
    mocks.resolvers.push(input.resolveSecret)
    return { loaded: { servers: [], errors: [] } }
  },
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async () => {
  const { McpVaultError } = await import('../../../../ports/mcp-errors')
  return {
    mcpVaultHasSecret: mocks.exists,
    resolveMcpVaultSecret: mocks.resolve,
    McpVaultError,
  }
})
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))

const { getOpenWaggleMcpConfigurationService } = await import('../openwaggle-mcp-configuration')

describe("Settings' and the CLI's MCP view", () => {
  it('checks that referenced secrets exist without decrypting them', async () => {
    await Effect.runPromise(getOpenWaggleMcpConfigurationService().getView({ projectPath: null }))
    const resolveSecret = mocks.resolvers.at(-1)

    await expect(resolveSecret?.('STORED')).resolves.toBeTypeOf('string')
    await expect(resolveSecret?.('MISSING')).rejects.toThrow('MCP secret "MISSING" was not found.')
    // A slow or prompting keychain does not slow Settings down.
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
