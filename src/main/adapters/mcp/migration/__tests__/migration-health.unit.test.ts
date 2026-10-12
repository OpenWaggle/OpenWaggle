import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  forgetMcpFileMigrationOutcomes,
  mcpFileMigrationPending,
  pendingMcpFileMigration,
  recordMcpFileMigrationOutcome,
} from '../migration-health'
import { memoryFs, NOW } from './migration-fixtures'

let root: string
let homeDir: string

beforeEach(() => {
  forgetMcpFileMigrationOutcomes()
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-migration-health-'))
  homeDir = path.join(root, 'home')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('an OpenWaggle MCP file whose migration failed', () => {
  it('is remembered as failed until a later run migrates it', async () => {
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    const fs = memoryFs({ [globalFile]: { mcpServers: { a: { command: 'a', required: true } } } })
    fs.failWritesTo = globalFile

    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW, fs })
    expect(mcpFileMigrationPending(globalFile)?.error).toContain('EACCES')

    fs.failWritesTo = undefined
    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW, fs })
    expect(mcpFileMigrationPending(globalFile)?.error).toBeUndefined()
  })

  it('is not loaded, so its old servers do not connect, and the error says why', async () => {
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    mkdirSync(path.dirname(globalFile), { recursive: true })
    writeFileSync(globalFile, JSON.stringify({ mcpServers: { old: { command: 'old-mcp' } } }))
    const piFile = path.join(homeDir, '.pi', 'agent', 'mcp.json')
    mkdirSync(path.dirname(piFile), { recursive: true })
    writeFileSync(piFile, JSON.stringify({ mcpServers: { pi: { command: 'pi-mcp' } } }))
    const fs = memoryFs({
      [globalFile]: { mcpServers: { old: { command: 'old-mcp', required: true } } },
    })
    fs.failWritesTo = globalFile
    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW, fs })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir: path.dirname(piFile), projectPath: null },
      resolveSecret: async () => '',
    })

    // Pi's server too: the overrides that keep what the old OpenWaggle had off are what the
    // migration writes, so nothing in the scope connects until it does.
    expect(config.loaded.servers.map((server) => server.name)).toEqual([])
    // One notice, naming the file and what to do; the file's own line is not repeated.
    expect(config.loaded.errors).toEqual([
      expect.stringContaining('MCP servers stay off here until'),
    ])
    expect(config.loaded.errors[0]?.split(globalFile)).toHaveLength(2)
    expect(config.loaded.errors[0]).toContain('Fix')
    // Its servers are unknown, not removed: the state read compares none of them.
    expect(config.merged.incomplete).toBe(true)
  })

  it('is the same file whichever spelling of its folder reaches it', () => {
    const real = path.join(root, 'real')
    mkdirSync(path.join(real, '.openwaggle'), { recursive: true })
    symlinkSync(real, path.join(root, 'linked'))
    const linkedFile = path.join(root, 'linked', '.openwaggle', 'mcp.json')

    recordMcpFileMigrationOutcome(linkedFile, 'EACCES')
    expect(mcpFileMigrationPending(path.join(real, '.openwaggle', 'mcp.json'))?.error).toBe(
      'EACCES',
    )
    recordMcpFileMigrationOutcome(path.join(real, '.openwaggle', 'mcp.json'))
    expect(mcpFileMigrationPending(linkedFile)?.error).toBeUndefined()
  })

  it('stays failed once a dangling folder link resolves, until a migration succeeds', () => {
    const project = path.join(root, 'project')
    const dotfiles = path.join(root, 'dotfiles', 'openwaggle')
    mkdirSync(project, { recursive: true })
    // The dotfiles checkout is not mounted when the migration fails.
    symlinkSync(dotfiles, path.join(project, '.openwaggle'))
    const file = path.join(project, '.openwaggle', 'mcp.json')
    recordMcpFileMigrationOutcome(file, 'links to a missing folder')

    // Mounted again: the file now leads somewhere else, still in the old format.
    mkdirSync(dotfiles, { recursive: true })
    writeFileSync(path.join(dotfiles, 'mcp.json'), '{"mcpServers":{}}')
    expect(mcpFileMigrationPending(file)?.error).toBe('links to a missing folder')

    recordMcpFileMigrationOutcome(file)
    expect(mcpFileMigrationPending(file)?.error).toBeUndefined()
    expect(
      mcpFileMigrationPending(path.join(project, '.openwaggle', 'mcp.json'))?.error,
    ).toBeUndefined()
  })

  it('stays failed under any spelling of the project folder once its link resolves', () => {
    const real = path.join(root, 'real-project')
    const linkedProject = path.join(root, 'linked-project')
    const dotfiles = path.join(root, 'dotfiles', 'openwaggle')
    mkdirSync(real, { recursive: true })
    symlinkSync(real, linkedProject)
    symlinkSync(dotfiles, path.join(real, '.openwaggle'))
    const tail = path.join('.openwaggle', 'mcp.json')
    // The migration ran under the project's link spelling while the dotfiles were not mounted.
    recordMcpFileMigrationOutcome(path.join(linkedProject, tail), 'links to a missing folder')

    mkdirSync(dotfiles, { recursive: true })
    writeFileSync(path.join(dotfiles, 'mcp.json'), '{"mcpServers":{}}')
    // Settings and Runs reach the project by its real path.
    expect(mcpFileMigrationPending(path.join(real, tail))?.error).toBe('links to a missing folder')

    recordMcpFileMigrationOutcome(path.join(real, tail))
    expect(mcpFileMigrationPending(path.join(linkedProject, tail))?.error).toBeUndefined()
  })

  describe('as a write that may change several files sees it', () => {
    it("looks past a failure that keeps no old state to a kept project's", () => {
      const viewed = path.join(root, 'viewed')
      const kept = path.join(root, 'kept')
      const viewedFile = path.join(viewed, '.openwaggle', 'mcp.json')
      const keptFile = path.join(kept, '.openwaggle', 'mcp.json')
      // Added after the first run: its migration only converts the format.
      recordMcpFileMigrationOutcome(viewedFile, 'links to a missing folder', {
        keepsLegacyState: false,
      })
      recordMcpFileMigrationOutcome(keptFile, 'links to a missing folder')

      expect(pendingMcpFileMigration(homeDir, viewed, 'everywhere')?.path).toBe(keptFile)
      expect(pendingMcpFileMigration(homeDir, viewed, 'global')?.path).toBe(keptFile)
      // A write to the viewed project alone waits for nothing that would undo it.
      expect(pendingMcpFileMigration(homeDir, viewed, 'all')).toMatchObject({
        path: viewedFile,
        keepsLegacyState: false,
      })
      recordMcpFileMigrationOutcome(viewedFile)
      recordMcpFileMigrationOutcome(keptFile)
    })
  })
})
