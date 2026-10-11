import { afterEach, describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() => vi.fn())

// The shared setup gives this file a temporary HOME; the real entry point runs here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../mcp/migration/migrate-openwaggle-mcp-files', () => ({
  migrateOpenWaggleMcpFiles: migrate,
}))
vi.mock('../../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
// The keychain does not answer: every read of an old sign-in times out.
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async () => {
  const { McpVaultError } = await import('../../../../ports/mcp-errors')
  return {
    listMcpVaultSecretNames: async () => ['oauth.docs'],
    resolveMcpVaultSecret: async () => {
      throw new McpVaultError({
        reason: 'encryption-unavailable',
        message: 'The system keychain did not answer within 20 s',
      })
    },
    sharedMcpVaultHasSecret: async () => false,
  }
})
vi.mock('../../../mcp/credentials/mcp-build-state-paths', () => ({
  mcpBuildStateDirectory: () => '/user-data/OpenWaggle Dev/mcp',
}))
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({ projectPath: null, recentProjects: [], projectDisplayNames: {} }),
}))
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionProjectRoots: async () => [],
}))

const { MCP_MIGRATION_KEYCHAIN_RETRY_MS, MCP_MIGRATION_RETRY_MS, migrateOpenWaggleMcpSignInsOnce } =
  await import('../openwaggle-mcp-migration')

afterEach(() => {
  vi.useRealTimers()
  migrate.mockReset()
})

describe('the sign-in migration with a keychain that does not answer', () => {
  it('waits longer before it reads the keychain again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    migrate.mockImplementation(async (input) => {
      const failed = await input.oauth.readOld('oauth.docs').then(
        () => false,
        () => true,
      )
      return {
        files: [],
        oauth: failed ? [{ server: 'docs', key: 'k', status: 'failed', reason: 'keychain' }] : [],
        droppedSessionStates: 0,
      }
    })

    await migrateOpenWaggleMcpSignInsOnce('/projects/keychain')
    const firstAttempt = migrate.mock.calls.length
    // Each Run that waits for the migration would otherwise wait for the keychain again.
    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpSignInsOnce('/projects/keychain')
    expect(migrate).toHaveBeenCalledTimes(firstAttempt)

    vi.advanceTimersByTime(MCP_MIGRATION_KEYCHAIN_RETRY_MS)
    await migrateOpenWaggleMcpSignInsOnce('/projects/keychain')
    expect(migrate.mock.calls.length).toBeGreaterThan(firstAttempt)
  })
})
