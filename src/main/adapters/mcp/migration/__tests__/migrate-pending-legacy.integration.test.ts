import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { mcpUpdateRefusal } from '../../config/mcp-write-refusal'
import { withRuntimeConfigErrors } from '../../config/migrating-mcp-configuration-service'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { pendingMcpFileMigration } from '../migration-health'
import { NOW } from './migration-fixtures'
import {
  cleanUpPendingLegacy,
  setUpPendingLegacy,
  temporaryRoots,
  writeJson,
} from './pending-legacy-setup'

afterEach(cleanUpPendingLegacy)

const setUp = setUpPendingLegacy

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
    temporaryRoots.push(root)
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

  it("lets a global write through while a kept project's file needs fixing", async () => {
    const { migrate, danglingProject, service, statePath, root, connectable } = await setUp()
    const project = await danglingProject('kept')
    // The old OpenWaggle had g on everywhere but in that project.
    await writeJson(statePath, {
      version: 1,
      globalState: 'on',
      projectServerStates: { [project]: { g: 'off' } },
    })
    await migrate([project])

    // An unmounted dotfiles checkout would otherwise hold every global change back for good.
    await expect(
      Effect.runPromise(
        service.setServerEnabled({ projectPath: null, name: 'g', enabled: true, target: 'server' }),
      ),
    ).resolves.toBeUndefined()

    // Once it is mounted and migrated, that project keeps its old choice.
    await mkdir(path.join(root, 'unmounted', 'kept'), { recursive: true })
    await migrate([project])
    expect(await connectable(null)).toContain('g')
    expect(await connectable(project)).not.toContain('g')
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

  it("lets Pi's /mcp change a global file in another project's Run likewise", async () => {
    const { migrate, danglingProject, homeDir, piAgentDir, root } = await setUp()
    const kept = await danglingProject('kept')
    const other = path.join(root, 'other')
    await mkdir(other, { recursive: true })
    await migrate([kept])
    await migrate([other])
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')

    expect(
      mcpUpdateRefusal({ homeDir, piAgentDir, projectPath: other })(globalFile),
    ).toBeUndefined()
    // In that project's own Run, its file still waits to be fixed.
    const inKept = mcpUpdateRefusal({ homeDir, piAgentDir, projectPath: kept })
    expect(inKept(path.join(kept, '.openwaggle', 'mcp.json'))?.message).toContain('Fix')
  })
})
