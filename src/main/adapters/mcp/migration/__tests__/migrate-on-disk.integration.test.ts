import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { migrationBackupPath } from '../migration-paths'
import { allConnectedState, NOW, oldFingerprint } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('migrateOpenWaggleMcpFiles on disk', () => {
  it('migrates a global and a project file once, with backups, using the real file system', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-migration-'))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    const projectPath = path.join(root, 'project')
    const piGlobal = path.join(homeDir, '.pi', 'agent', 'mcp.json')
    const openwaggleGlobal = path.join(homeDir, '.openwaggle', 'mcp.json')
    const projectFile = path.join(projectPath, '.openwaggle', 'mcp.json')
    const normalized = { command: 'npx', args: ['tools-mcp'] }
    await writeJson(piGlobal, { mcpServers: { tools: { command: 'npx', args: ['tools-mcp'] } } })
    const openwaggleGlobalContent = {
      mcpServers: {
        tools: {
          ...normalized,
          directTools: true,
          provenance: {
            source: 'pi',
            sourcePath: piGlobal,
            fingerprint: oldFingerprint(piGlobal, 'tools', normalized),
          },
        },
      },
    }
    const projectContent = { mcpServers: { local: { command: 'local', required: true } } }
    await writeJson(openwaggleGlobal, openwaggleGlobalContent)
    await writeJson(projectFile, projectContent)
    // MCP was on and both servers were turned on, so the migration keeps them on.
    await writeJson(
      path.join(homeDir, '.openwaggle', 'mcp', 'state.json'),
      allConnectedState({
        [openwaggleGlobal]: openwaggleGlobalContent,
        [projectFile]: projectContent,
      }),
    )

    const first = await migrateOpenWaggleMcpFiles({
      homeDir,
      projectPaths: [projectPath],
      now: () => NOW,
    })
    const second = await migrateOpenWaggleMcpFiles({
      homeDir,
      projectPaths: [projectPath],
      now: () => NOW,
    })

    expect(first.files.map((file) => file.status)).toEqual(['migrated', 'migrated'])
    expect(second.files.map((file) => file.status)).toEqual([
      'already-migrated',
      'already-migrated',
    ])
    expect(await readJson(openwaggleGlobal)).toEqual({
      mcpServers: { tools: { exposure: 'direct' } },
    })
    expect(await readJson(projectFile)).toEqual({ mcpServers: { local: { command: 'local' } } })
    // The project's backup is kept in the user's OpenWaggle data, never in the repository.
    expect(await readdir(path.dirname(projectFile))).toEqual(['mcp.json'])
    expect(await readJson(migrationBackupPath(projectFile, homeDir))).toEqual({
      mcpServers: { local: { command: 'local', required: true } },
    })
    expect(path.relative(homeDir, migrationBackupPath(projectFile, homeDir))).toMatch(
      /^\.openwaggle\/mcp\/backups\/[^/]+\/mcp\.json\.pre-adr-0048\.bak$/,
    )
    expect((await readdir(path.join(homeDir, '.openwaggle'))).sort()).toEqual([
      'mcp',
      'mcp.json',
      'mcp.json.pre-adr-0048.bak',
    ])
    expect(await readdir(path.join(homeDir, '.pi', 'agent'))).toEqual(['mcp.json'])
  })
})
