import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFilesystemMcpConfigurationService } from '../../config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../config/mcp-runtime-config'
import { migrateBeforeEachCall } from '../../config/migrating-mcp-configuration-service'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  forgetMcpFileMigrationOutcomes,
  pendingKeptProjects,
  pendingMcpFileMigration,
} from '../migration-health'
import { NOW } from './migration-fixtures'

/** Every temporary folder, removed after each test. */
export const temporaryRoots: string[] = []

export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function setUpPendingLegacy(
  serversOf: (globalFile: string) => Record<string, unknown> = () => ({}),
) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-legacy-')))
  temporaryRoots.push(root)
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

/** Each test starts as a new Host would: no failures kept, no folders left. */
export async function cleanUpPendingLegacy() {
  forgetMcpFileMigrationOutcomes()
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
}
