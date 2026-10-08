import { afterEach, describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() => vi.fn())

// The shared setup gives this file a temporary HOME; the real entry point runs here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../mcp/migration/migrate-openwaggle-mcp-files', () => ({
  migrateOpenWaggleMcpFiles: migrate,
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  resolveMcpVaultSecret: async () => undefined,
}))

const { MCP_MIGRATION_RETRY_MS, migrateOpenWaggleMcpFilesOnce } = await import(
  '../openwaggle-mcp-migration'
)

const OK = { files: [], oauth: [], droppedSessionStates: 0 }

afterEach(() => {
  vi.useRealTimers()
  migrate.mockReset()
})

describe('the MCP file migration within one Host process', () => {
  it('runs once when it succeeds', async () => {
    migrate.mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/ok')
    await migrateOpenWaggleMcpFilesOnce('/projects/ok')

    expect(migrate).toHaveBeenCalledOnce()
  })

  it('tries again after a failure, once a short wait has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    migrate
      .mockResolvedValueOnce({ ...OK, error: 'the record could not be read' })
      .mockResolvedValueOnce({ ...OK, files: [{ path: '/x', status: 'failed', changes: [] }] })
      .mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/flaky')
    await migrateOpenWaggleMcpFilesOnce('/projects/flaky')
    expect(migrate).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpFilesOnce('/projects/flaky')
    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpFilesOnce('/projects/flaky')
    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpFilesOnce('/projects/flaky')

    expect(migrate).toHaveBeenCalledTimes(3)
  })
})
