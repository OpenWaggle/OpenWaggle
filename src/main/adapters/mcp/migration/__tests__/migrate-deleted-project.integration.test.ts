import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { forgetMcpFileMigrationOutcomes, mcpFileMigrationPending } from '../migration-health'
import { NOW } from './migration-fixtures'

const roots: string[] = []

afterEach(async () => {
  forgetMcpFileMigrationOutcomes()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** An old state.json naming a project whose folder was deleted since. */
async function setUp() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-deleted-')))
  roots.push(root)
  const homeDir = path.join(root, 'home')
  const project = path.join(root, 'deleted')
  await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
    version: 1,
    globalState: 'on',
    projectStates: { [project]: 'off' },
    sessionStates: {},
    projectServerStates: {},
    servers: {},
  })
  const migrate = () => migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW })
  const record = () =>
    JSON.parse(readFileSync(path.join(homeDir, '.openwaggle', 'mcp', 'migration.json'), 'utf8'))
  return { root, project, migrate, record }
}

describe('a project the old state names whose folder is gone', () => {
  it('is left alone: no folder is created, nothing is recorded or gated', async () => {
    const { project, migrate, record } = await setUp()

    const report = await migrate()

    expect(existsSync(project)).toBe(false)
    const file = path.join(project, '.openwaggle', 'mcp.json')
    expect(record().files[file]).toBeUndefined()
    expect(mcpFileMigrationPending(file)).toBeUndefined()
    expect(report.files.map((entry) => entry.path)).not.toContain(file)
  })

  it('migrates once it is cloned again, keeping its old choices', async () => {
    const { project, migrate, record } = await setUp()
    await migrate()

    await writeJson(path.join(project, '.mcp.json'), { mcpServers: { x: { command: 'x' } } })
    await migrate()

    const file = path.join(project, '.openwaggle', 'mcp.json')
    expect(record().files[file]?.status).toBe('migrated')
    expect(existsSync(file)).toBe(true)
  })

  it('is not "gone" while it is a link to a folder that is not mounted: that still fails', async () => {
    const { root, project, migrate } = await setUp()
    await symlink(path.join(root, 'unmounted'), project)

    await migrate()

    expect(existsSync(path.join(root, 'unmounted'))).toBe(false)
    expect(mcpFileMigrationPending(path.join(project, '.openwaggle', 'mcp.json'))).toBeDefined()
  })
})
