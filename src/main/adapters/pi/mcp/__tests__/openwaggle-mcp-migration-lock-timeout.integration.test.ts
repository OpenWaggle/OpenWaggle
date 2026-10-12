import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mcpFileMigrationFailure } from '../../../mcp/migration/migration-health'
import { migrationRecordPath } from '../../../mcp/migration/migration-record'

/** A short lock wait stands for the 30 s one, so the test does not wait that long. */
const SHORT_LOCK_WAIT_MS = 200

// The shared setup gives this file a temporary HOME; the real migration runs against it here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../mcp/process-file-lock', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../mcp/process-file-lock')>()
  return {
    ...original,
    withProcessFileLock: (
      filePath: string,
      run: () => Promise<unknown>,
      options?: Parameters<typeof original.withProcessFileLock>[2],
    ) => {
      lockCalls.count += 1
      return original.withProcessFileLock(
        filePath,
        run,
        options?.maxWaitMs === undefined ? options : { ...options, maxWaitMs: SHORT_LOCK_WAIT_MS },
      )
    },
  }
})
const settings = vi.hoisted(() => {
  const recentProjects: string[] = []
  return { recentProjects }
})
const lockCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({
    projectPath: null,
    recentProjects: settings.recentProjects,
    projectDisplayNames: {},
  }),
}))
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionProjectRoots: async () => [],
  listSessionWorkspaceRootPage: async () => [],
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  resolveMcpVaultSecret: async () => {
    throw new Error('no vault in this test')
  },
}))

const { migrateOpenWaggleMcpFilesAtHostStart, migrateOpenWaggleMcpFilesOnce } = await import(
  '../openwaggle-mcp-migration'
)
const { withProcessFileLock } = await import('../../../mcp/process-file-lock')

describe('the MCP file migration when another process keeps the lock', () => {
  it('keeps the old files from loading until it could migrate them', async () => {
    const globalFile = path.join(homedir(), '.openwaggle', 'mcp.json')
    const project = path.join(homedir(), 'work', 'app')
    const projectFile = path.join(project, '.openwaggle', 'mcp.json')
    for (const file of [globalFile, projectFile]) {
      mkdirSync(path.dirname(file), { recursive: true })
      // An old-format file: loaded as it is, its servers the old OpenWaggle had off would start.
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { fs: { command: 'fs', directTools: true } } }),
      )
    }
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    // Another Host holds the lock longer than this one waits.
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))

    await migrateOpenWaggleMcpFilesOnce(project)

    expect(mcpFileMigrationFailure(globalFile)).toEqual(expect.any(String))
    expect(mcpFileMigrationFailure(projectFile)).toEqual(expect.any(String))
    released.resolve()
    await otherHost
  })

  it('leaves a file it migrated before loadable', async () => {
    const globalFile = path.join(homedir(), '.openwaggle', 'mcp.json')
    const project = path.join(homedir(), 'work', 'other')
    const projectFile = path.join(project, '.openwaggle', 'mcp.json')
    for (const file of [globalFile, projectFile]) {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { fs: { command: 'fs', directTools: true } } }),
      )
    }
    await migrateOpenWaggleMcpFilesOnce(null)
    expect(mcpFileMigrationFailure(globalFile)).toBeUndefined()
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))

    await migrateOpenWaggleMcpFilesOnce(project)

    expect(mcpFileMigrationFailure(globalFile)).toBeUndefined()
    expect(mcpFileMigrationFailure(projectFile)).toEqual(expect.any(String))
    released.resolve()
    await otherHost
  })

  it('does not gate a file that is not there in a project that keeps no old state', async () => {
    await migrateOpenWaggleMcpFilesOnce(null)
    const added = path.join(homedir(), 'work', 'added-later')
    mkdirSync(added, { recursive: true })
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))

    await migrateOpenWaggleMcpFilesOnce(added)

    expect(mcpFileMigrationFailure(path.join(added, '.openwaggle', 'mcp.json'))).toBeUndefined()
    released.resolve()
    await otherHost
  })

  it("does not gate a managed worktree's file, which no run migrates or clears", async () => {
    const worktree = path.join(homedir(), '.openwaggle', 'worktrees', 'project', 'session-1')
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))

    await migrateOpenWaggleMcpFilesOnce(worktree)

    expect(mcpFileMigrationFailure(path.join(worktree, '.openwaggle', 'mcp.json'))).toBeUndefined()
    released.resolve()
    await otherHost
  })

  it('at Host start, waits for the lock once, then leaves the other scopes to the retry', async () => {
    const projects = ['alpha', 'beta', 'gamma'].map((name) => path.join(homedir(), 'start', name))
    for (const project of projects) {
      const file = path.join(project, '.openwaggle', 'mcp.json')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { fs: { command: 'fs', directTools: true } } }),
      )
    }
    settings.recentProjects = projects
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))
    lockCalls.count = 0

    await migrateOpenWaggleMcpFilesAtHostStart()

    // One wait for the lock, not one per scope: Host start is not held for (1 + N) waits.
    expect(lockCalls.count).toBe(1)
    for (const project of projects) {
      expect(mcpFileMigrationFailure(path.join(project, '.openwaggle', 'mcp.json'))).toEqual(
        expect.any(String),
      )
    }
    released.resolve()
    await otherHost
    settings.recentProjects = []
  })
})
