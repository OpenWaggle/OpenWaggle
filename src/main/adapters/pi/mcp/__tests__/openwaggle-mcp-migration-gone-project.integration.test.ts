import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMcpRuntimeConfig } from '../../../mcp/config/mcp-runtime-config'
import { migrationRecordPath } from '../../../mcp/migration/migration-record'

// The shared setup gives this file a temporary HOME; the real migration runs against it here.
vi.unmock('../openwaggle-mcp-migration')
const settings = vi.hoisted(() => {
  const recentProjects: string[] = []
  return { recentProjects }
})
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

const {
  MCP_MIGRATION_RETRY_MS,
  migrateOpenWaggleMcpFilesAtHostStart,
  migrateOpenWaggleMcpFilesOnce,
} = await import('../openwaggle-mcp-migration')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a known project whose folder is gone at Host start', () => {
  it('is migrated before it loads once it is cloned again in the same process', async () => {
    const project = path.join(path.dirname(homedir()), 'gone-at-start')
    settings.recentProjects.push(project)
    const statePath = path.join(homedir(), '.openwaggle', 'mcp', 'state.json')
    mkdirSync(path.dirname(statePath), { recursive: true })
    // The old OpenWaggle had MCP off in that project.
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, globalState: 'on', projectStates: { [project]: 'off' } }),
    )
    await migrateOpenWaggleMcpFilesAtHostStart()
    expect(existsSync(project)).toBe(false)

    // Cloned again: its committed .mcp.json comes back.
    mkdirSync(project, { recursive: true })
    writeFileSync(
      path.join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { repo: { command: 'repo-mcp' } } }),
    )
    const later = Date.now() + MCP_MIGRATION_RETRY_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await migrateOpenWaggleMcpFilesOnce(project)

    const file = path.join(project, '.openwaggle', 'mcp.json')
    const record = JSON.parse(readFileSync(migrationRecordPath(homedir()), 'utf8'))
    expect(record.files[file]?.status).toBe('migrated')
    const config = await loadMcpRuntimeConfig({
      roots: {
        homeDir: homedir(),
        piAgentDir: path.join(homedir(), '.pi', 'agent'),
        projectPath: project,
      },
      resolveSecret: async () => '',
    })
    const on = config.loaded.servers.filter((server) => server.config.enabled !== false)
    expect(on.map((server) => server.name)).not.toContain('repo')
  })
})
