import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async (input: { resolveSecret: (name: string) => Promise<string> }) => {
    mocks.resolvers.push(input.resolveSecret)
    const error = 'MCP server "locked": MCP secret "MISSING" was not found.'
    return {
      loaded: { servers: [], errors: [error] },
      unavailable: new Map([
        ['locked', error],
        ['off', 'MCP server "off": MCP secret "MISSING" was not found.'],
      ]),
      merged: { servers: [{ name: 'off', config: { command: 'x', enabled: false } }], errors: [] },
    }
  },
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/encrypted-mcp-secret-vault-service')>()),
  checkMcpVaultSecret: mocks.check,
  resolveMcpVaultSecret: mocks.resolve,
}))

const { getMcpServerStatuses } = await import('../pi-mcp-server-status')

describe("Settings' MCP server states", () => {
  it('check that secrets exist without decrypting them, and show a server that lacks one', async () => {
    const statuses = await getMcpServerStatuses(
      { projectPath: null },
      { homeDir: '/home/user', piAgentDir: '/home/user/.pi/agent' },
      fromPartial({}),
    )
    const resolveSecret = mocks.resolvers.at(-1)

    expect(resolveSecret).toBe(mocks.check)
    await expect(resolveSecret?.('STORED')).resolves.toBeTypeOf('string')
    await expect(resolveSecret?.('MISSING')).rejects.toThrow('was not found')
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(statuses).toEqual([
      {
        name: 'locked',
        source: 'last-check',
        checkedAt: expect.any(Number),
        inspection: {
          name: 'locked',
          state: 'failed',
          tools: [],
          error: 'MCP server "locked": MCP secret "MISSING" was not found.',
        },
      },
      { name: 'off', source: 'not-checked' },
    ])
  })
})
