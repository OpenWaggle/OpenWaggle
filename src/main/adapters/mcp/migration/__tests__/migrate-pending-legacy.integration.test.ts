import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../../config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { migrateBeforeEachCall } from '../../config/migrating-mcp-configuration-service'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { pendingMcpFileMigration } from '../migration-health'
import { NOW } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setUp(serversOf: (globalFile: string) => Record<string, unknown> = () => ({})) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-legacy-')))
  roots.push(root)
  const homeDir = path.join(root, 'home')
  const piAgentDir = path.join(homeDir, '.pi', 'agent')
  const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
  const statePath = path.join(homeDir, '.openwaggle', 'mcp', 'state.json')
  await writeJson(globalFile, { mcpServers: { g: { command: 'g' } } })
  await writeJson(statePath, {
    version: 1,
    globalState: 'on',
    projectStates: {},
    sessionStates: {},
    projectServerStates: {},
    servers: serversOf(globalFile),
  })
  const migrate = (projectPaths: readonly string[]) =>
    migrateOpenWaggleMcpFiles({ homeDir, piAgentDir, projectPaths, now: () => NOW })
  const connectable = async (projectPath: string | null) => {
    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath },
      resolveSecret: async () => '',
    })
    return config.loaded.servers
      .filter((server) => server.config.enabled !== false)
      .map((server) => server.name)
  }
  /** A project whose .openwaggle folder is in a dotfiles checkout that is not mounted. */
  const danglingProject = async (name: string) => {
    const project = path.join(root, name)
    await mkdir(project, { recursive: true })
    await symlink(path.join(root, 'unmounted', name), path.join(project, '.openwaggle'))
    await writeJson(path.join(project, '.mcp.json'), {
      mcpServers: { [`${name}-mcp`]: { command: 'x' } },
    })
    return project
  }
  const service = migrateBeforeEachCall(
    createFilesystemMcpConfigurationService({ homeDir, piAgentDir }),
    async (projectPath) => migrate(projectPath ? [projectPath] : []),
    {
      pendingMigration: (projectPath, scope) =>
        pendingMcpFileMigration(homeDir, projectPath, scope),
    },
  )
  return { homeDir, statePath, migrate, connectable, danglingProject, service }
}

describe('the old state a pending migration keeps', () => {
  it('leaves migrated files loadable when state.json breaks after the migration', async () => {
    // The old OpenWaggle had g on.
    const { statePath, migrate, connectable, homeDir } = await setUp((globalFile) => ({
      [legacyServerIdentityKey(globalFile, 'g')]: { enabled: true, instanceId: 'g' },
    }))
    await migrate([])
    expect(await connectable(null)).toEqual(['g'])

    await writeFile(statePath, '{ "version": 1,')
    const report = await migrate([])

    expect(report.error).toContain(statePath)
    expect(await connectable(null)).toEqual(['g'])
    expect(pendingMcpFileMigration(homeDir, null)).toBeUndefined()
  })

  it('is none for a project added after the first run, which only converts its format', async () => {
    const { migrate, connectable, danglingProject, homeDir } = await setUp()
    await migrate([])
    const added = await danglingProject('added')

    await migrate([added])

    // Its file is left out, but nothing in it waits to be applied: its scope stays open.
    expect(await connectable(added)).toContain('added-mcp')
    expect(pendingMcpFileMigration(homeDir, added)).toMatchObject({ keepsLegacyState: false })
  })

  it("refuses a global write while a project's old state waits, naming that project's file", async () => {
    const { migrate, danglingProject, service } = await setUp()
    const project = await danglingProject('kept')
    // The first run keeps the project's old on/off; its file cannot be migrated yet.
    await migrate([project])

    const refused = await Effect.runPromise(
      Effect.flip(
        service.setServerEnabled({ projectPath: null, name: 'g', enabled: true, target: 'server' }),
      ),
    )

    // Turned on now, g would be turned off for that project once its migration ran.
    expect(refused.message).toContain(path.join(project, '.openwaggle', 'mcp.json'))
  })
})
