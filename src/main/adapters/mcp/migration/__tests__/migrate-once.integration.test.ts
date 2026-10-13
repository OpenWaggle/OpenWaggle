import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../../config/filesystem-mcp-configuration-service'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { NOW } from './migration-fixtures'

const roots: string[] = []

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function home() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-migrate-once-'))
  roots.push(root)
  return path.join(root, 'home')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// ADR 0051: each file is migrated once. A later launch never applies the old on/off state again.
describe('the one-time MCP file migration', () => {
  it('leaves a migrated file the user edited in Settings as it is, toggles and all', async () => {
    const homeDir = await home()
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    const manual = { source: 'manual', importedAt: '2025-01-01T00:00:00Z' }
    // The old OpenWaggle: MCP on, "docs" turned on, "idle" never turned on.
    await writeJson(globalFile, {
      mcpServers: {
        docs: { command: 'docs-mcp', provenance: manual },
        idle: { command: 'idle-mcp', provenance: manual },
      },
    })
    await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'on',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {
        [legacyServerIdentityKey(globalFile, 'docs')]: { enabled: true, instanceId: 'i-docs' },
        [legacyServerIdentityKey(globalFile, 'idle')]: { enabled: false, instanceId: 'i-idle' },
      },
    })
    const migrate = () => migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => NOW })
    await migrate()
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
    })
    const scope = { projectPath: null, target: 'server' } as const
    await Effect.runPromise(service.setServerEnabled({ ...scope, name: 'docs', enabled: false }))
    await Effect.runPromise(service.setServerEnabled({ ...scope, name: 'idle', enabled: true }))
    await Effect.runPromise(
      service.addServer({
        projectPath: null,
        name: 'fresh',
        entry: { command: 'fresh-mcp' },
        scope: 'global',
      }),
    )
    const edited = await readJson(globalFile)

    const next = await migrate()

    expect(next.files.find((file) => file.path === globalFile)?.status).toBe('already-migrated')
    expect(await readJson(globalFile)).toEqual(edited)
  })

  it('loads an old-format file restored after its migration as it is, keeping the first backup', async () => {
    const homeDir = await home()
    const projectPath = path.join(path.dirname(homeDir), 'project')
    const file = path.join(projectPath, '.openwaggle', 'mcp.json')
    await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'off',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {},
    })
    const original = { mcpServers: { a: { command: 'a', directTools: true } } }
    await writeJson(file, original)
    const migrate = async () =>
      (
        await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [projectPath], now: () => NOW })
      ).files.find((report) => report.path === file)
    const first = await migrate()
    // A teammate still on the old OpenWaggle commits another old-format file; a pull restores it.
    const restored = { mcpServers: { b: { command: 'b', directTools: true } } }
    await writeJson(file, restored)

    // Documented limit (docs/mcp-runtime.md): it is not migrated again.
    expect((await migrate())?.status).toBe('already-migrated')
    expect(await readJson(file)).toEqual(restored)
    expect(JSON.parse(await readFile(first?.backupPath ?? '', 'utf8'))).toEqual(original)
  })
})
