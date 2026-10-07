import { describe, expect, it } from 'vitest'
import { legacyNormalizeImportedServer } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  allConnectedState,
  connectedFs,
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

const DOCS_NORMALIZED = { url: 'https://docs.example.com/mcp', transport: 'streamable-http' }
const TOOLS_NORMALIZED = { command: 'tools-mcp', args: ['--stdio'] }

function migrate(fs: ReturnType<typeof memoryFs>) {
  return migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })
}

function globalServers(fs: ReturnType<typeof memoryFs>) {
  const value = fs.json(OPENWAGGLE_GLOBAL)
  return typeof value === 'object' && value !== null && 'mcpServers' in value
    ? value.mcpServers
    : undefined
}

describe('migrating Pi copies in ~/.openwaggle/mcp.json', () => {
  it('keeps a copy edited after import as a full entry without its Pi provenance', async () => {
    const copy = piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED)
    const fs = connectedFs({
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: { ...copy, args: ['--stdio', '--verbose'], directTools: true },
        },
      },
    })

    const report = await migrate(fs)

    expect(globalServers(fs)).toEqual({
      tools: { command: 'tools-mcp', args: ['--stdio', '--verbose'], exposure: 'direct' },
    })
    expect(report.files[0]?.changes).toEqual([
      {
        server: 'tools',
        action: 'converted',
        details: ['kept because the copy was edited after import.'],
      },
    ])
  })

  it('keeps a copy that holds vault secrets, because the Pi entry needs shell variables', async () => {
    // The old importer turned Pi's ${GITHUB_TOKEN} into a vault secret; dropping the copy would
    // leave a Dock-launched app with only the Pi entry, and no GITHUB_TOKEN to resolve it from.
    const piEntry = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    }
    const normalized = legacyNormalizeImportedServer('github', piEntry)
    expect(normalized).toMatchObject({
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secret: 'GITHUB_TOKEN' } },
    })
    const fs = connectedFs({
      [PI_GLOBAL]: { mcpServers: { github: piEntry } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: { github: piCopy(PI_GLOBAL, 'github', normalized ?? {}) },
      },
    })

    const report = await migrate(fs)

    expect(globalServers(fs)).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secret: 'GITHUB_TOKEN' } },
      },
    })
    expect(report.files[0]?.changes[0]?.details).toEqual([
      'kept because the copy reads vault secrets, which the Pi entry does not.',
    ])
  })

  it('keeps an orphaned copy whose Pi entry was removed', async () => {
    const fs = connectedFs({
      [PI_GLOBAL]: { mcpServers: {} },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED) } },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('keeps a copy whose Pi entry changed after import', async () => {
    const fs = connectedFs({
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--http'] } } },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED) } },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('keeps a copy imported from a Pi file that is no longer read live', async () => {
    const legacyPiFile = `${HOME}/.config/mcp/mcp.json`
    const fs = connectedFs({
      [legacyPiFile]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: { tools: piCopy(legacyPiFile, 'tools', TOOLS_NORMALIZED) },
      },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('turns a directTools list on a removed copy into a toolExposure override', async () => {
    const fs = connectedFs({
      [PI_GLOBAL]: {
        mcpServers: {
          docs: { url: 'https://docs.example.com/mcp', toolExposure: { delete_page: 'hidden' } },
        },
      },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          docs: { ...piCopy(PI_GLOBAL, 'docs', DOCS_NORMALIZED), directTools: ['search', 'fetch'] },
        },
      },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({
      docs: { toolExposure: { delete_page: 'hidden', search: 'direct', fetch: 'direct' } },
    })
  })

  it('removes the copy entirely when the Pi entry already exposes its tools directly', async () => {
    const fs = connectedFs({
      [PI_GLOBAL]: {
        mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'], exposure: 'direct' } },
      },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: { ...piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED), directTools: true },
        },
      },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({})
  })

  it("reads Pi's global file from PI_CODING_AGENT_DIR when Pi is set up there", async () => {
    const piAgentDir = '/custom/pi-agent'
    const piGlobal = `${piAgentDir}/mcp.json`
    const fs = connectedFs({
      [piGlobal]: {
        mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'], exposure: 'direct' } },
      },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: { ...piCopy(piGlobal, 'tools', TOOLS_NORMALIZED), directTools: true },
        },
      },
    })

    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      piAgentDir,
      projectPaths: [],
      now: () => NOW,
      fs,
    })

    expect(globalServers(fs)).toEqual({})
  })

  it('keeps servers that connected on and turns off every server that did not', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: {
        mcpServers: {
          tools: { command: 'tools-mcp', args: ['--stdio'] },
          piOnly: { command: 'pi-only-mcp' },
        },
      },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED),
          local: { command: 'local-mcp' },
          neverEnabled: { command: 'other-mcp' },
        },
      },
      [LEGACY_STATE]: legacyState({
        globalState: 'on',
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'tools')]: {
            instanceId: 'a',
            enabled: true,
            trustedConfigHash: 'h1',
          },
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'local')]: {
            instanceId: 'b',
            enabled: false,
            trustedConfigHash: 'h2',
          },
          // Never turned on: it never passed the old trust step, so it never connected.
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'neverEnabled')]: { instanceId: 'c', enabled: false },
        },
      }),
    })

    const report = await migrate(fs)

    // `piOnly` was never read by the old code, so it did not connect either.
    expect(globalServers(fs)).toEqual({
      local: { command: 'local-mcp', enabled: false },
      neverEnabled: { command: 'other-mcp', enabled: false },
      piOnly: { enabled: false },
    })
    expect(report.files[0]?.changes).toContainEqual({
      server: 'neverEnabled',
      action: 'disabled-by-state',
      details: ['turned off because it was not turned on in OpenWaggle'],
    })
  })

  it('turns every server off when MCP was off in OpenWaggle', async () => {
    const files = {
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED),
          local: { command: 'local-mcp' },
        },
      },
    }
    const fs = memoryFs({
      ...files,
      [LEGACY_STATE]: { ...allConnectedState(files), globalState: 'off' },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({
      tools: { enabled: false },
      local: { command: 'local-mcp', enabled: false },
    })
  })

  it('leaves Pi servers on for someone who never set up MCP in OpenWaggle', async () => {
    const fs = memoryFs({ [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp' } } } })

    const report = await migrate(fs)

    expect(fs.files.has(OPENWAGGLE_GLOBAL)).toBe(false)
    expect(report.files).toEqual([{ path: OPENWAGGLE_GLOBAL, status: 'unchanged', changes: [] }])
  })
})
