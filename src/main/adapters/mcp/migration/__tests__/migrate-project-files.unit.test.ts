import { describe, expect, it, vi } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  allConnectedState,
  HOME,
  LEGACY_STATE,
  legacyState,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
  oldIdentityKey,
  PI_GLOBAL,
  piCopy,
} from './migration-fixtures'

const PROJECT = '/work/app'
const PROJECT_FILE = `${PROJECT}/.openwaggle/mcp.json`
const PROJECT_PI = `${PROJECT}/.pi/mcp.json`
const PROJECT_MCP_JSON = `${PROJECT}/.mcp.json`
const LINT = { command: 'lint-mcp' }

function migrate(fs: ReturnType<typeof memoryFs>, projectPaths: readonly string[] = [PROJECT]) {
  return migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths, now: () => NOW, fs })
}

describe('migrating <project>/.openwaggle/mcp.json', () => {
  it('removes an unchanged copy of the project Pi file', async () => {
    const fs = memoryFs({
      [PROJECT_PI]: { mcpServers: { lint: LINT } },
      [PROJECT_FILE]: {
        mcpServers: { lint: { ...piCopy(PROJECT_PI, 'lint', LINT), directTools: true } },
      },
    })

    await migrate(fs)

    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { lint: { exposure: 'direct' } } })
  })

  it('keeps a copy of a global Pi entry when a project file would define it instead', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: { lint: LINT } },
      [PROJECT_MCP_JSON]: { mcpServers: { lint: { command: 'other-lint' } } },
      [PROJECT_FILE]: { mcpServers: { lint: piCopy(PI_GLOBAL, 'lint', LINT) } },
    })

    await migrate(fs)

    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { lint: LINT } })
  })

  it('turns a server switched off for the project into an override, creating the file', async () => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: { lint: LINT, docs: { command: 'docs-mcp' } } },
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        projectServerStates: { [PROJECT]: { 'lint-id': 'off', 'docs-id': 'on' } },
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'lint')]: { instanceId: 'lint-id', enabled: true },
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'docs')]: { instanceId: 'docs-id', enabled: true },
        },
      }),
    })

    const report = await migrate(fs, [])

    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { lint: { enabled: false } } })
    expect(fs.files.has(`${PROJECT_FILE}.pre-adr-0048.bak`)).toBe(false)
    expect(report.files.map((file) => [file.path, file.status])).toEqual([
      [OPENWAGGLE_GLOBAL, 'unchanged'],
      [PROJECT_FILE, 'migrated'],
    ])
  })

  it('asks to keep a file it created out of git, and never one that existed', async () => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: { lint: LINT } },
      [PROJECT_PI]: { mcpServers: { lint: LINT } },
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        projectServerStates: { [PROJECT]: { 'lint-id': 'off' } },
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'lint')]: { instanceId: 'lint-id', enabled: true },
        },
      }),
    })
    const keepOutOfGit = vi.fn(async () => undefined)

    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      keepCreatedFileOutOfGit: keepOutOfGit,
    })

    expect(fs.files.has(PROJECT_FILE)).toBe(true)
    expect(keepOutOfGit.mock.calls).toEqual([[PROJECT_FILE]])
  })

  it('finds a per-project switch on a global copy that the migration replaced', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: { lint: LINT } },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { lint: piCopy(PI_GLOBAL, 'lint', LINT) } },
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        projectServerStates: { [PROJECT]: { 'lint-id': 'off' } },
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'lint')]: { instanceId: 'lint-id', enabled: true },
        },
      }),
    })

    await migrate(fs)

    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({ mcpServers: {} })
    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { lint: { enabled: false } } })
  })

  it('turns every server visible in a project off when MCP was off for that project', async () => {
    const files = {
      [PI_GLOBAL]: { mcpServers: { piServer: { command: 'pi-mcp' } } },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { owServer: { command: 'ow-mcp' } } },
      [PROJECT_MCP_JSON]: { mcpServers: { shared: { command: 'shared-mcp' } } },
      [PROJECT_FILE]: { mcpServers: { local: { command: 'local-mcp' } } },
    }
    const fs = memoryFs({
      ...files,
      [LEGACY_STATE]: {
        ...allConnectedState(files),
        projectStates: { [PROJECT]: 'off', '/work/other': 'on' },
      },
    })

    await migrate(fs)

    // Pi's file was never read before, so its server is off everywhere.
    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({
      mcpServers: { owServer: { command: 'ow-mcp' }, piServer: { enabled: false } },
    })
    expect(fs.json(PROJECT_FILE)).toEqual({
      mcpServers: {
        local: { command: 'local-mcp', enabled: false },
        owServer: { enabled: false },
        shared: { enabled: false },
      },
    })
    expect(fs.files.has('/work/other/.openwaggle/mcp.json')).toBe(false)
  })

  it('keeps a server on in a project where MCP was on although it was off elsewhere', async () => {
    const files = { [OPENWAGGLE_GLOBAL]: { mcpServers: { owServer: { command: 'ow-mcp' } } } }
    const fs = memoryFs({
      ...files,
      [LEGACY_STATE]: {
        ...allConnectedState(files),
        globalState: 'off',
        projectStates: { [PROJECT]: 'on' },
      },
    })

    const report = await migrate(fs)

    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({
      mcpServers: { owServer: { command: 'ow-mcp', enabled: false } },
    })
    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { owServer: { enabled: true } } })
    expect(report.files[1]?.changes).toEqual([
      {
        server: 'owServer',
        action: 'enabled-by-state',
        details: ['kept on, as it connected before'],
      },
    ])
  })

  it('leaves projects OpenWaggle did not know at the first run to the new behaviour', async () => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: {} },
      [LEGACY_STATE]: legacyState({ globalState: 'on' }),
    })
    await migrate(fs, [])
    fs.files.set(PROJECT_PI, `${JSON.stringify({ mcpServers: { lint: LINT } })}\n`)

    await migrate(fs, [PROJECT])

    expect(fs.files.has(PROJECT_FILE)).toBe(false)
  })

  it('keeps the on/off state of every project OpenWaggle knew at the first run', async () => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: {} },
      [PROJECT_PI]: { mcpServers: { lint: LINT } },
      [LEGACY_STATE]: legacyState({ globalState: 'on' }),
    })

    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      knownProjectPaths: () => Promise.resolve([PROJECT]),
      now: () => NOW,
      fs,
    })
    await migrate(fs, [PROJECT])

    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { lint: { enabled: false } } })
  })

  it('carries a .mcp.json server the user turned off as an override and never writes .mcp.json', async () => {
    const mcpJson = `${JSON.stringify({ mcpServers: { shared: { command: 'shared-mcp' } } })}\n`
    const fs = memoryFs({
      [PROJECT_MCP_JSON]: mcpJson,
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        servers: {
          [oldIdentityKey(PROJECT_MCP_JSON, 'shared')]: {
            instanceId: 'shared-id',
            enabled: false,
            trustedConfigHash: 'h',
          },
        },
      }),
    })

    await migrate(fs)

    expect(fs.json(PROJECT_FILE)).toEqual({ mcpServers: { shared: { enabled: false } } })
    expect(fs.files.get(PROJECT_MCP_JSON)).toBe(mcpJson)
    expect(fs.writes).not.toContain(PROJECT_MCP_JSON)
  })

  it('reports the dropped session switches', async () => {
    const fs = memoryFs({
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        sessionStates: { 'session-1': 'off', 'session-2': 'on' },
      }),
    })

    const report = await migrate(fs, [])

    expect(report.droppedSessionStates).toBe(2)
  })

  it('migrates each project once, also when it is passed again later', async () => {
    const fs = memoryFs({
      [PROJECT_FILE]: { mcpServers: { local: { command: 'local-mcp', required: true } } },
    })
    await migrate(fs)
    fs.writes.length = 0

    const again = await migrate(fs)

    expect(fs.writes).toEqual([])
    expect(again.files.map((file) => file.status)).toEqual(['already-migrated', 'already-migrated'])
  })
})
