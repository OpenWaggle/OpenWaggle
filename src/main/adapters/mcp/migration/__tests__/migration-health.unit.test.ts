import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { mcpFileMigrationFailure, recordMcpFileMigrationOutcome } from '../migration-health'
import { memoryFs, NOW } from './migration-fixtures'

let root: string
let homeDir: string

beforeEach(() => {
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
    expect(mcpFileMigrationFailure(globalFile)).toContain('EACCES')

    fs.failWritesTo = undefined
    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW, fs })
    expect(mcpFileMigrationFailure(globalFile)).toBeUndefined()
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

    expect(config.loaded.servers.map((server) => server.name)).toEqual(['pi'])
    expect(config.loaded.errors).toEqual([
      expect.stringContaining(`${globalFile} was not loaded: its one-time migration failed`),
    ])
    // Its servers are unknown, not removed: the state read compares none of them.
    expect(config.merged.incomplete).toBe(true)
  })

  it('is the same file whichever spelling of its folder reaches it', () => {
    const real = path.join(root, 'real')
    mkdirSync(path.join(real, '.openwaggle'), { recursive: true })
    symlinkSync(real, path.join(root, 'linked'))
    const linkedFile = path.join(root, 'linked', '.openwaggle', 'mcp.json')

    recordMcpFileMigrationOutcome(linkedFile, 'EACCES')
    expect(mcpFileMigrationFailure(path.join(real, '.openwaggle', 'mcp.json'))).toBe('EACCES')
    recordMcpFileMigrationOutcome(path.join(real, '.openwaggle', 'mcp.json'))
    expect(mcpFileMigrationFailure(linkedFile)).toBeUndefined()
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
    expect(mcpFileMigrationFailure(file)).toBe('links to a missing folder')

    recordMcpFileMigrationOutcome(file)
    expect(mcpFileMigrationFailure(file)).toBeUndefined()
    expect(mcpFileMigrationFailure(path.join(project, '.openwaggle', 'mcp.json'))).toBeUndefined()
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
    expect(mcpFileMigrationFailure(path.join(real, tail))).toBe('links to a missing folder')

    recordMcpFileMigrationOutcome(path.join(real, tail))
    expect(mcpFileMigrationFailure(path.join(linkedProject, tail))).toBeUndefined()
  })
})
