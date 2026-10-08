import { afterEach, describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() => vi.fn())

// The shared setup gives this file a temporary HOME; the real entry point runs here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../mcp/migration/migrate-openwaggle-mcp-files', () => ({
  migrateOpenWaggleMcpFiles: migrate,
}))
vi.mock('../../../../store/session-mcp-switch', () => {
  class UnknownMcpSessionError extends Error {}
  return {
    UnknownMcpSessionError,
    disableSessionMcp: async (sessionId: string) => {
      if (sessionId === 'deleted') throw new UnknownMcpSessionError(sessionId)
      if (sessionId === 'broken') throw new Error('database is locked')
    },
  }
})
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

  it('carries an old MCP-off switch over, skipping Sessions deleted since then', async () => {
    migrate.mockResolvedValue(OK)
    await migrateOpenWaggleMcpFilesOnce('/projects/switches')
    const sink: (sessionId: string) => Promise<void> = migrate.mock.calls[0]?.[0].sessionMcpSwitch

    await expect(sink('deleted')).resolves.toBeUndefined()
    await expect(sink('broken')).rejects.toThrow('database is locked')
  })
})
