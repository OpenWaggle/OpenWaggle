import { describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
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
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: { ...copy, env: { TOKEN: { secret: 'TOOLS_TOKEN' } }, directTools: true },
        },
      },
    })

    const report = await migrate(fs)

    expect(globalServers(fs)).toEqual({
      tools: {
        command: 'tools-mcp',
        args: ['--stdio'],
        env: { TOKEN: { secret: 'TOOLS_TOKEN' } },
        exposure: 'direct',
      },
    })
    expect(report.files[0]?.changes).toEqual([
      {
        server: 'tools',
        action: 'converted',
        details: ['kept because the copy was edited after import.'],
      },
    ])
  })

  it('keeps an orphaned copy whose Pi entry was removed', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: {} },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED) } },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('keeps a copy whose Pi entry changed after import', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--http'] } } },
      [OPENWAGGLE_GLOBAL]: { mcpServers: { tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED) } },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('keeps a copy imported from a Pi file that is no longer read live', async () => {
    const legacyPiFile = `${HOME}/.config/mcp/mcp.json`
    const fs = memoryFs({
      [legacyPiFile]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: { tools: piCopy(legacyPiFile, 'tools', TOOLS_NORMALIZED) },
      },
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({ tools: { command: 'tools-mcp', args: ['--stdio'] } })
  })

  it('turns a directTools list on a removed copy into a toolExposure override', async () => {
    const fs = memoryFs({
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
    const fs = memoryFs({
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

  it('carries a server the user turned off into the entry or its override', async () => {
    const fs = memoryFs({
      [PI_GLOBAL]: { mcpServers: { tools: { command: 'tools-mcp', args: ['--stdio'] } } },
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          tools: piCopy(PI_GLOBAL, 'tools', TOOLS_NORMALIZED),
          local: { command: 'local-mcp' },
          neverEnabled: { command: 'other-mcp' },
        },
      },
      [LEGACY_STATE]: legacyState({
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'tools')]: {
            instanceId: 'a',
            enabled: false,
            trustedConfigHash: 'h1',
          },
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'local')]: {
            instanceId: 'b',
            enabled: false,
            trustedConfigHash: 'h2',
          },
          // Never enabled: the old trust gate's default, not a user choice.
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'neverEnabled')]: { instanceId: 'c', enabled: false },
        },
      }),
    })

    await migrate(fs)

    expect(globalServers(fs)).toEqual({
      tools: { enabled: false },
      local: { command: 'local-mcp', enabled: false },
      neverEnabled: { command: 'other-mcp' },
    })
  })
})
