import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const MISSING_ERROR = vi.hoisted(
  () =>
    'mcp.json: server "api": env "TOKEN" names vault secret "API_TOKEN", which could not be read',
)

const mocks = vi.hoisted(() => {
  const resolvers: ((name: string) => Promise<string>)[] = []
  return {
    resolvers,
    check: vi.fn(async (name: string) => {
      if (name === 'STORED') return 'vault-secret'
      throw new Error(`MCP secret "${name}" was not found.`)
    }),
    resolve: vi.fn(async () => 'decrypted'),
  }
})

vi.mock('../../../mcp/config/mcp-runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/config/mcp-runtime-config')>()),
  loadMcpRuntimeConfig: async (input: { resolveSecret: (name: string) => Promise<string> }) => {
    mocks.resolvers.push(input.resolveSecret)
    return {
      loaded: { servers: [], errors: [MISSING_ERROR, 'docs: vault secret could not be decrypted'] },
      missingSecrets: new Map([['api', MISSING_ERROR]]),
    }
  },
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async () => {
  const { McpVaultError } = await import('../../../../ports/mcp-errors')
  return {
    checkMcpVaultSecret: mocks.check,
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

    expect(resolveSecret).toBe(mocks.check)
    await expect(resolveSecret?.('STORED')).resolves.toBeTypeOf('string')
    await expect(resolveSecret?.('MISSING')).rejects.toThrow('MCP secret "MISSING" was not found.')
    // A slow or prompting keychain does not slow Settings down.
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it("marks a missing secret's error, which Settings leaves to the server's row", async () => {
    const view = await Effect.runPromise(
      getOpenWaggleMcpConfigurationService().getView({ projectPath: null }),
    )

    expect(view.errors).toEqual([MISSING_ERROR, 'docs: vault secret could not be decrypted'])
    expect(view.missingSecretErrors).toEqual([MISSING_ERROR])
    expect(view.missingSecretServers).toEqual(['api'])
  })
})
