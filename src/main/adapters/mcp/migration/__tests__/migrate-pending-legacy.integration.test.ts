import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../../config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { mcpUpdateRefusal } from '../../config/mcp-write-refusal'
import {
  migrateBeforeEachCall,
  withRuntimeConfigErrors,
} from '../../config/migrating-mcp-configuration-service'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  forgetMcpFileMigrationOutcomes,
  pendingKeptProjects,
  pendingMcpFileMigration,
} from '../migration-health'
import { NOW } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  // Failures are kept per process; each test starts as a new Host would.
  forgetMcpFileMigrationOutcomes()
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
      pendingKeptProjects: () => pendingKeptProjects(homeDir),
    },
  )
  return { homeDir, piAgentDir, statePath, migrate, connectable, danglingProject, service, root }
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

    // Everything asked for is migrated and decided, so the old state is not even read.
    expect(report.error).toBeUndefined()
    expect(await connectable(null)).toEqual(['g'])
    expect(pendingMcpFileMigration(homeDir, null)).toBeUndefined()
  })

  it('leaves a fresh install alone when a state.json it never had appears broken', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-legacy-')))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    const piAgentDir = path.join(homeDir, '.pi', 'agent')
    await writeJson(path.join(piAgentDir, 'mcp.json'), { mcpServers: { pi: { command: 'pi' } } })
    const migrate = () =>
      migrateOpenWaggleMcpFiles({ homeDir, piAgentDir, projectPaths: [], now: () => NOW })
    // No old state and no OpenWaggle file: nothing to keep, decided on the first run.
    await migrate()
    await mkdir(path.join(homeDir, '.openwaggle', 'mcp'), { recursive: true })
    await writeFile(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), '{ broken')

    const report = await migrate()
    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath: null },
      resolveSecret: async () => '',
    })

    expect(report.error).toBeUndefined()
    expect(config.loaded.servers.map((server) => server.name)).toEqual(['pi'])
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

  it('shows a left-out file once in Settings, in the notice that names it once', async () => {
    const { homeDir, piAgentDir, migrate, danglingProject, service } = await setUp()
    const project = await danglingProject('gamma')
    const file = path.join(project, '.openwaggle', 'mcp.json')
    await migrate([project])
    const settings = withRuntimeConfigErrors(service, async (projectPath) => {
      const config = await loadMcpRuntimeConfig({
        roots: { homeDir, piAgentDir, projectPath },
        resolveSecret: async () => '',
      })
      return { errors: config.loaded.errors }
    })

    const view = await Effect.runPromise(settings.getView({ projectPath: project }))

    const aboutFile = view.errors.filter((error) => error.includes(file))
    expect(aboutFile).toEqual([expect.stringContaining('MCP servers stay off here until')])
    expect(aboutFile[0]?.split(file)).toHaveLength(2)
  })

  it('lets the global write through once that project file is fixed, from any scope', async () => {
    const { migrate, danglingProject, service, root } = await setUp()
    const project = await danglingProject('kept')
    await migrate([project])
    const turnOn = service.setServerEnabled({
      projectPath: null,
      name: 'g',
      enabled: true,
      target: 'server',
    })
    await Effect.runPromise(Effect.flip(turnOn))

    // The dotfiles checkout is mounted again; nobody opens that project before the next write.
    await mkdir(path.join(root, 'unmounted', 'kept'), { recursive: true })

    await expect(Effect.runPromise(turnOn)).resolves.toBeUndefined()
  })

  it("refuses Pi's /mcp change to a global file in another project's Run likewise", async () => {
    const { migrate, danglingProject, homeDir, piAgentDir, root } = await setUp()
    const kept = await danglingProject('kept')
    const other = path.join(root, 'other')
    await mkdir(other, { recursive: true })
    await migrate([kept])
    await migrate([other])
    const refusal = mcpUpdateRefusal({ homeDir, piAgentDir, projectPath: other })

    expect(refusal(path.join(homeDir, '.openwaggle', 'mcp.json'))?.message).toContain(
      path.join(kept, '.openwaggle', 'mcp.json'),
    )
    // That Run's own project file waits for nothing that would undo it.
    expect(refusal(path.join(other, '.openwaggle', 'mcp.json'))).toBeUndefined()
  })
})
