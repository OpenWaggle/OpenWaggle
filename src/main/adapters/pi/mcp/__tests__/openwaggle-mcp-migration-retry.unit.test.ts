import { afterEach, describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() => vi.fn())
const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))

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
vi.mock('../../../../logger', () => ({ createLogger: () => logged }))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', async () => {
  const { McpVaultError } = await import('../../../../ports/mcp-errors')
  return {
    resolveMcpVaultSecret: async (name: string) => {
      if (name === 'oauth.signed-in') return '{"version":1}'
      const reason = name === 'oauth.locked' ? 'decryption-failed' : 'secret-not-found'
      throw new McpVaultError({ reason, message: `vault: ${reason}` })
    },
  }
})

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

  it('treats spellings of one project path as one project', async () => {
    migrate.mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/same/')
    await migrateOpenWaggleMcpFilesOnce('/projects/./same')
    await migrateOpenWaggleMcpFilesOnce('/projects/same')

    expect(migrate).toHaveBeenCalledOnce()
    expect(migrate.mock.calls[0]?.[0].projectPaths).toEqual(['/projects/same'])
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

  it('logs a migration that throws, with its project, and tries it again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    migrate.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(OK)

    await expect(migrateOpenWaggleMcpFilesOnce('/projects/throws')).resolves.toBeUndefined()
    expect(logged.error).toHaveBeenCalledWith(
      expect.stringContaining('MCP migration failed'),
      expect.objectContaining({ projectPath: '/projects/throws', error: 'disk full' }),
    )

    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpFilesOnce('/projects/throws')
    expect(migrate).toHaveBeenCalledTimes(2)
  })

  it('tries again after an OAuth sign-in failed to migrate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const failedSignIn = { server: 'docs', key: 'k', status: 'failed', reason: 'locked' }
    migrate.mockResolvedValueOnce({ ...OK, oauth: [failedSignIn] }).mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/oauth')
    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpFilesOnce('/projects/oauth')

    expect(migrate).toHaveBeenCalledTimes(2)
  })

  it('reads an old sign-in, reports no sign-in as none, and a vault failure as a failure', async () => {
    migrate.mockResolvedValue(OK)
    await migrateOpenWaggleMcpFilesOnce('/projects/vault')
    const readOld: (name: string) => Promise<string | undefined> =
      migrate.mock.calls[0]?.[0].oauth.readOld

    await expect(readOld('oauth.signed-in')).resolves.toBe('{"version":1}')
    await expect(readOld('oauth.never')).resolves.toBeUndefined()
    await expect(readOld('oauth.locked')).rejects.toThrow('decryption-failed')
  })

  it('carries an old MCP-off switch over, skipping Sessions deleted since then', async () => {
    migrate.mockResolvedValue(OK)
    await migrateOpenWaggleMcpFilesOnce('/projects/switches')
    const sink: (sessionId: string) => Promise<void> = migrate.mock.calls[0]?.[0].sessionMcpSwitch

    await expect(sink('deleted')).resolves.toBeUndefined()
    await expect(sink('broken')).rejects.toThrow('database is locked')
  })
})
