import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { NOW } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('a scope whose OpenWaggle file has not been migrated yet', () => {
  it('starts none of its servers, then follows the migrated on/off', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-pending-')))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    const piAgentDir = path.join(homeDir, '.pi', 'agent')
    const project = path.join(root, 'project')
    const dotfiles = path.join(root, 'dotfiles', 'openwaggle')
    await mkdir(project, { recursive: true })
    // The project's .openwaggle is in a dotfiles checkout that is not mounted yet.
    await symlink(dotfiles, path.join(project, '.openwaggle'))
    // The old OpenWaggle read .mcp.json and had "docs" on. It never read the project's Pi file, so
    // the migration turns its server off, in the project's OpenWaggle file.
    await writeJson(path.join(project, '.mcp.json'), { mcpServers: { docs: { command: 'docs' } } })
    await writeJson(path.join(project, '.pi', 'mcp.json'), {
      mcpServers: { pi: { command: 'pi' } },
    })
    await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'on',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {
        [legacyServerIdentityKey(path.join(project, '.mcp.json'), 'docs')]: {
          enabled: true,
          instanceId: 'docs',
        },
      },
    })
    const migrate = () =>
      migrateOpenWaggleMcpFiles({ homeDir, piAgentDir, projectPaths: [project], now: () => NOW })
    const connectable = async () => {
      const config = await loadMcpRuntimeConfig({
        roots: { homeDir, piAgentDir, projectPath: project },
        resolveSecret: async () => '',
      })
      return config.loaded.servers
        .filter((server) => server.config.enabled !== false)
        .map((server) => server.name)
    }

    await migrate()
    // Not the Pi file's server either: its override is what the pending migration writes.
    expect(await connectable()).toEqual([])

    await mkdir(dotfiles, { recursive: true })
    await migrate()
    expect(await connectable()).toEqual(['docs'])
  })
})
