import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { NOW, recordingLogger } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * One project, two spellings: `linked` is a symbolic link to `real`, as /tmp is to /private/tmp.
 * The old OpenWaggle knew it as `linked` and had its "docs" server turned on.
 */
async function projectWithTwoSpellings(stateKnowsProject: boolean) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-spellings-')))
  roots.push(root)
  const homeDir = path.join(root, 'home')
  const real = path.join(root, 'real-project')
  const linked = path.join(root, 'linked-project')
  await mkdir(real, { recursive: true })
  await symlink(real, linked)
  await writeJson(path.join(real, '.openwaggle', 'mcp.json'), {
    mcpServers: { docs: { command: 'docs-mcp', directTools: true } },
  })
  const oldFile = path.join(linked, '.openwaggle', 'mcp.json')
  await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
    version: 1,
    globalState: 'on',
    projectStates: stateKnowsProject ? { [linked]: 'inherit' } : {},
    sessionStates: {},
    projectServerStates: {},
    servers: { [legacyServerIdentityKey(oldFile, 'docs')]: { enabled: true, instanceId: 'docs' } },
  })
  const migrate = (projectPath: string, knownProjectPaths: readonly string[] = []) =>
    migrateOpenWaggleMcpFiles({
      homeDir,
      projectPaths: [projectPath],
      knownProjectPaths: async () => knownProjectPaths,
      now: () => NOW,
    })
  return { homeDir, real, linked, projectFile: path.join(real, '.openwaggle', 'mcp.json'), migrate }
}

async function docsEntry(projectFile: string) {
  const config: { mcpServers: Record<string, Record<string, unknown>> } = JSON.parse(
    await readFile(projectFile, 'utf8'),
  )
  return config.mcpServers.docs
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('a project the migration reaches by two spellings', () => {
  it('is migrated once: the other spelling reads already-migrated and turns nothing off', async () => {
    const project = await projectWithTwoSpellings(true)
    await project.migrate(project.linked)
    const migrated = await readFile(project.projectFile, 'utf8')
    expect(await docsEntry(project.projectFile)).not.toHaveProperty('enabled', false)

    const again = await project.migrate(project.real)

    expect(
      again.files.filter((file) => file.status !== 'already-migrated').map((file) => file.path),
    ).toEqual([])
    expect(await readFile(project.projectFile, 'utf8')).toBe(migrated)
  })

  it("finds the old state by the project's real folder when it is known by another spelling", async () => {
    const project = await projectWithTwoSpellings(true)

    await project.migrate(project.real)

    expect(await docsEntry(project.projectFile)).not.toHaveProperty('enabled', false)
  })

  it('tries every known spelling of the folder for its old server switches', async () => {
    // state.json names the project nowhere but in its servers' keys; Settings knows both.
    const project = await projectWithTwoSpellings(false)

    await project.migrate(project.real, [project.real, project.linked])

    expect(await docsEntry(project.projectFile)).not.toHaveProperty('enabled', false)
  })

  it.each([
    ['recorded under the link', false],
    ['after a first run that recorded no project', true],
  ])('is migrated once without an .openwaggle folder, %s', async (_when, firstRunKnewNoProject) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-spellings-')))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    const real = path.join(root, 'real-project')
    const linked = path.join(root, 'linked-project')
    await mkdir(real, { recursive: true })
    await symlink(real, linked)
    // Only the shared .mcp.json, whose "docs" server the old OpenWaggle had turned on.
    await writeJson(path.join(real, '.mcp.json'), { mcpServers: { docs: { command: 'docs-mcp' } } })
    await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'on',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {
        [legacyServerIdentityKey(path.join(linked, '.mcp.json'), 'docs')]: {
          enabled: true,
          instanceId: 'docs',
        },
      },
    })
    const migrate = (projectPath: string) =>
      migrateOpenWaggleMcpFiles({
        homeDir,
        projectPaths: [projectPath],
        knownProjectPaths: async () => [projectPath],
        now: () => NOW,
      })
    const projectFile = (spelling: string) => path.join(spelling, '.openwaggle', 'mcp.json')
    if (firstRunKnewNoProject) {
      // That first run recorded no project, so the record lends no spelling later.
      await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW })
    }
    const first = await migrate(linked)
    expect(first.files.find((file) => file.path === projectFile(linked))?.status).toBe('unchanged')

    const again = await migrate(real)

    // Under whichever spelling it is reported, the project's file is the one already handled.
    expect(again.files.map((file) => file.status)).toEqual(['already-migrated', 'already-migrated'])
    // No file turning docs off was written.
    await expect(readFile(projectFile(real), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.for([
    ['a symbolic link', 'link'],
    ['a spelling in another case, where case does not matter', 'case'],
  ] as const)(
    'says once that the home folder keeps no switches of its own, reached by %s',
    async ([_how, kind], context) => {
      const root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-spellings-')))
      roots.push(root)
      const homeDir = path.join(root, 'home')
      const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
      await writeJson(globalFile, { mcpServers: { own: { command: 'own-mcp' } } })
      const linkedHome = kind === 'link' ? path.join(root, 'linked-home') : path.join(root, 'HOME')
      if (kind === 'link') await symlink(homeDir, linkedHome)
      // Only on a file system that ignores case (macOS and Windows by default).
      if (!existsSync(linkedHome)) context.skip()
      // The old OpenWaggle opened the home folder by both spellings, with "own" off there.
      const own = { enabled: true, instanceId: 'own-id' }
      await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
        version: 1,
        globalState: 'on',
        projectStates: { [homeDir]: 'inherit', [linkedHome]: 'inherit' },
        sessionStates: {},
        projectServerStates: { [homeDir]: { 'own-id': 'off' }, [linkedHome]: { 'own-id': 'off' } },
        servers: { [legacyServerIdentityKey(globalFile, 'own')]: own },
      })
      const logger = recordingLogger()
      const migrate = (projectPath: string) =>
        migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [projectPath], now: () => NOW, logger })

      await migrate(homeDir)
      await migrate(linkedHome)

      const notices = vi
        .mocked(logger.warn)
        .mock.calls.filter(([message]) => message.includes('home folder'))
      expect(notices).toHaveLength(1)
      // Nor is the global file migrated again as that spelling's project file, turning "own" off.
      expect(JSON.parse(await readFile(globalFile, 'utf8'))).toEqual({
        mcpServers: { own: { command: 'own-mcp' } },
      })
    },
  )
})
