import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { mcpFileMigrationFailure } from '../migration-health'
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
  })
})
