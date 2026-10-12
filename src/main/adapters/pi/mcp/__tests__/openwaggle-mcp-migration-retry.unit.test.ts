import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() => vi.fn())
const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
// A keychain that stalls (or waits on a password prompt) while the old sign-ins are read.
const keychain = vi.hoisted(() => {
  const waiting: (() => void)[] = []
  const sessionProjects: string[] = []
  const state = {
    stalled: false,
    release: () => {
      state.stalled = false
      for (const resolve of waiting.splice(0)) resolve()
    },
  }
  return {
    state,
    sessionProjects,
    read: () =>
      state.stalled ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
  }
})

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
    listMcpVaultSecretNames: async () => ['oauth.signed-in', 'oauth.locked', 'TOKEN'],
    resolveMcpVaultSecret: async (name: string) => {
      await keychain.read()
      if (name === 'oauth.signed-in') return '{"version":1}'
      const reason = name === 'oauth.locked' ? 'decryption-failed' : 'secret-not-found'
      throw new McpVaultError({ reason, message: `vault: ${reason}` })
    },
    // The vault every build shared still holds this one, sealed by another build's key.
    sharedMcpVaultHasSecret: async (name: string) => name === 'oauth.other-build',
  }
})
vi.mock('../../../mcp/credentials/mcp-build-state-paths', () => ({
  mcpBuildStateDirectory: () => '/user-data/OpenWaggle Dev/mcp',
}))

vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({
    projectPath: '/projects/open',
    recentProjects: [],
    projectDisplayNames: {},
  }),
}))
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionProjectRoots: async () => keychain.sessionProjects,
}))

const {
  MCP_MIGRATION_RETRY_MS,
  MCP_MIGRATION_STOP_WAIT_MS,
  stopOpenWaggleMcpSignInMigration,
  migrateOpenWaggleMcpFilesAtHostStart,
  migrateOpenWaggleMcpFilesOnce,
  migrateOpenWaggleMcpSignInsAfterHostStart,
  migrateOpenWaggleMcpSignInsOnce,
} = await import('../openwaggle-mcp-migration')
const { SIGN_IN_NOT_READ_YET, SIGN_IN_OF_ANOTHER_BUILD } = await import(
  '../../../mcp/migration/oauth-state-migration'
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

  it('treats two spellings of one folder, such as a symbolic link, as one project', async () => {
    migrate.mockResolvedValue(OK)
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ow-mcp-spelling-')))
    const real = path.join(root, 'real')
    mkdirSync(real)
    symlinkSync(real, path.join(root, 'linked'))

    await migrateOpenWaggleMcpFilesOnce(path.join(root, 'linked'))
    await migrateOpenWaggleMcpFilesOnce(real)

    expect(migrate).toHaveBeenCalledOnce()
    rmSync(root, { recursive: true, force: true })
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

    await migrateOpenWaggleMcpSignInsOnce('/projects/oauth')
    vi.advanceTimersByTime(MCP_MIGRATION_RETRY_MS)
    await migrateOpenWaggleMcpSignInsOnce('/projects/oauth')

    expect(migrate).toHaveBeenCalledTimes(2)
  })

  // A keychain that is slow or asks for a password must not hold up whatever reads MCP files.
  it('migrates files without reading old sign-ins from the vault', async () => {
    migrate.mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/files-only')

    expect(migrate.mock.calls[0]?.[0].oauth).toBeUndefined()
  })

  it('migrates old sign-ins separately, once, after the files', async () => {
    migrate.mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesOnce('/projects/both')
    await migrateOpenWaggleMcpSignInsOnce('/projects/both')
    await migrateOpenWaggleMcpSignInsOnce('/projects/both')

    expect(migrate).toHaveBeenCalledTimes(2)
    expect(migrate.mock.calls[1]?.[0].oauth).toBeDefined()
  })

  it('starts the Host without reading the vault, and migrates sign-ins once it is ready', async () => {
    migrate.mockResolvedValue(OK)

    await migrateOpenWaggleMcpFilesAtHostStart()
    expect(migrate.mock.calls.map(([input]) => input.oauth)).toEqual([undefined, undefined])

    migrate.mockClear()
    await migrateOpenWaggleMcpSignInsAfterHostStart()
    expect(migrate.mock.calls.map(([input]) => input.projectPaths)).toEqual([
      [],
      ['/projects/open'],
    ])
    expect(migrate.mock.calls.every(([input]) => input.oauth !== undefined)).toBe(true)
  })

  it('logs a sign-in migration after Host start that fails, without throwing', async () => {
    migrate.mockRejectedValue(new Error('keychain unavailable'))

    await expect(migrateOpenWaggleMcpSignInsAfterHostStart()).resolves.toBeUndefined()
  })

  it('reads an old sign-in, reports no sign-in as none, and a vault failure as a failure', async () => {
    const names = ['oauth.signed-in', 'oauth.never', 'oauth.locked', 'oauth.other-build']
    migrate.mockImplementation(async (input) => {
      for (const name of names) await input.oauth.readOld(name).catch(() => undefined)
      return OK
    })
    await migrateOpenWaggleMcpSignInsOnce('/projects/vault')
    // The first pass only asks; the vault is read outside the lock, and the second pass moves them.
    expect(migrate).toHaveBeenCalledTimes(2)
    await expect(migrate.mock.calls[0]?.[0].oauth.readOld('oauth.signed-in')).resolves.toBe(
      SIGN_IN_NOT_READ_YET,
    )
    const readOld: (name: string) => Promise<string | undefined> =
      migrate.mock.calls[1]?.[0].oauth.readOld

    await expect(readOld('oauth.signed-in')).resolves.toBe('{"version":1}')
    await expect(readOld('oauth.never')).resolves.toBeUndefined()
    await expect(readOld('oauth.locked')).rejects.toThrow('decryption-failed')
    await expect(readOld('oauth.other-build')).resolves.toBe(SIGN_IN_OF_ANOTHER_BUILD)
    // Outcomes are recorded for this build: each build has its own sign-in store.
    expect(migrate.mock.calls[0]?.[0].oauth.buildKey).toBe('/user-data/OpenWaggle Dev/mcp')
  })

  it('carries an old MCP-off switch over, skipping Sessions deleted since then', async () => {
    migrate.mockResolvedValue(OK)
    await migrateOpenWaggleMcpFilesOnce('/projects/switches')
    const sink: (sessionId: string) => Promise<void> = migrate.mock.calls[0]?.[0].sessionMcpSwitch

    await expect(sink('deleted')).resolves.toBeUndefined()
    await expect(sink('broken')).rejects.toThrow('database is locked')
  })

  it('reads no keychain when no old sign-in is left to move', async () => {
    migrate.mockResolvedValue(OK)
    keychain.state.stalled = true

    // Every sign-in is recorded, so the migration asks for none.
    await migrateOpenWaggleMcpSignInsOnce('/projects/recorded')

    expect(migrate).toHaveBeenCalledOnce()
    keychain.state.release()
  })

  it("migrates a project's files while the sign-in migration waits for the keychain", async () => {
    migrate.mockImplementation(async (input) => {
      if (input.oauth) await input.oauth.readOld('oauth.signed-in')
      return OK
    })
    keychain.state.stalled = true

    const signIns = migrateOpenWaggleMcpSignInsOnce('/projects/stalled')
    const files = migrateOpenWaggleMcpFilesOnce('/projects/new')

    // Settings, the catalog and a Run's switch read wait for the files only.
    await expect(
      Promise.race([
        files.then(() => 'migrated'),
        new Promise((resolve) => setTimeout(() => resolve('waiting'), 300)),
      ]),
    ).resolves.toBe('migrated')
    keychain.state.release()
    await signIns
  })

  // Last: a stopped Host migrates no more sign-ins in this process.
  it('stops the sign-in migration at Host stop, waiting a bounded time for it', async () => {
    migrate.mockImplementation(async (input) => {
      if (input.oauth) await input.oauth.readOld('oauth.signed-in')
      return OK
    })
    keychain.state.stalled = true
    keychain.sessionProjects.push('/projects/at-stop')
    const afterStart = migrateOpenWaggleMcpSignInsAfterHostStart()
    await new Promise((resolve) => setTimeout(resolve, 0))

    vi.useFakeTimers()
    const stopped = stopOpenWaggleMcpSignInMigration()
    await vi.advanceTimersByTimeAsync(MCP_MIGRATION_STOP_WAIT_MS)
    await expect(stopped).resolves.toBeUndefined()
    vi.useRealTimers()

    // The keychain answers after the stop: nothing is written once the Host has stopped. Only the
    // first pass ran, which needs no keychain.
    keychain.state.release()
    await afterStart
    expect(migrate).toHaveBeenCalledOnce()
  })
})
