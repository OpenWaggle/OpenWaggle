import { describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { jsonText, MemoryMigrationFs } from './memory-migration-fs'
import { allConnectedState } from './migration-fixtures'

/**
 * Sanitized copy of a real pre-ADR-0048 install: servers imported from Pi's
 * global file into ~/.openwaggle/mcp.json. The fingerprints are the values the
 * old importer wrote, so these tests pin the exact legacy fingerprint algorithm.
 */
const HOME = '/Users/diego.garciabrisa'
const PI_GLOBAL = `${HOME}/.pi/agent/mcp.json`
const OPENWAGGLE_GLOBAL = `${HOME}/.openwaggle/mcp.json`
const MIGRATION_RECORD = `${HOME}/.openwaggle/mcp/migration.json`
const LEGACY_STATE = `${HOME}/.openwaggle/mcp/state.json`
const NOW = new Date('2026-10-01T12:00:00.000Z')

function piImportProvenance(fingerprint: string) {
  return {
    source: 'pi',
    sourcePath: PI_GLOBAL,
    fingerprint,
    importedAt: '2026-08-11T19:37:37.600Z',
  }
}

const REAL_PI_GLOBAL = {
  settings: { toolPrefix: 'server', idleTimeout: 10 },
  mcpServers: {
    'chrome-devtools': {
      command: 'npx',
      args: ['chrome-devtools-mcp@latest'],
      env: {},
      directTools: true,
    },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'], env: {}, directTools: true },
    datadog: {
      command: '/Users/diego.garciabrisa/.local/bin/datadog_mcp_cli',
      args: [],
      env: {},
      directTools: false,
    },
  },
}

const REAL_OPENWAGGLE_GLOBAL = {
  mcpServers: {
    'chrome-devtools': {
      command: 'npx',
      args: ['chrome-devtools-mcp@latest'],
      directTools: true,
      provenance: piImportProvenance(
        'b470f834066d2c1d7866519fbed70000e624fd96561714a73ff1dd86c5d2a3ba',
      ),
    },
    playwright: {
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      directTools: true,
      provenance: piImportProvenance(
        '92e946852f93a7a61a07dc55400f58b98b7d5ceeb51a1e0e7f0b676b5fdea785',
      ),
    },
    datadog: {
      command: '/Users/diego.garciabrisa/.local/bin/datadog_mcp_cli',
      directTools: false,
      provenance: piImportProvenance(
        '439d22d546097ff147d9d4b3db207262c6d87b2e25ab9696883dc0ca733a3417',
      ),
    },
  },
}

/** MCP was on and every imported server was turned on, so all of them connected. */
function realInstall() {
  return new MemoryMigrationFs({
    [PI_GLOBAL]: jsonText(REAL_PI_GLOBAL),
    [OPENWAGGLE_GLOBAL]: jsonText(REAL_OPENWAGGLE_GLOBAL),
    [LEGACY_STATE]: jsonText(allConnectedState({ [OPENWAGGLE_GLOBAL]: REAL_OPENWAGGLE_GLOBAL })),
  })
}

describe('migrateOpenWaggleMcpFiles on a real pre-ADR-0048 install', () => {
  it('replaces unchanged Pi copies with the live Pi entry, keeping direct exposure', async () => {
    const fs = realInstall()

    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })

    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({
      mcpServers: {
        'chrome-devtools': { exposure: 'direct' },
        playwright: { exposure: 'direct' },
      },
    })
  })

  it('keeps a backup of the original file next to it and never touches Pi files', async () => {
    const fs = realInstall()

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
    })

    expect(fs.files.get(`${OPENWAGGLE_GLOBAL}.pre-adr-0048.bak`)).toBe(
      jsonText(REAL_OPENWAGGLE_GLOBAL),
    )
    expect(fs.files.get(PI_GLOBAL)).toBe(jsonText(REAL_PI_GLOBAL))
    expect(fs.writes.filter((written) => written.includes('/.pi/'))).toEqual([])
    expect(report.files).toEqual([
      expect.objectContaining({
        path: OPENWAGGLE_GLOBAL,
        status: 'migrated',
        backupPath: `${OPENWAGGLE_GLOBAL}.pre-adr-0048.bak`,
      }),
    ])
  })

  it('runs once: a second run changes nothing and reports the file as already migrated', async () => {
    const fs = realInstall()
    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })
    const afterFirst = new Map(fs.files)
    fs.writes.length = 0

    const second = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
    })

    expect(fs.writes).toEqual([])
    expect(fs.files).toEqual(afterFirst)
    expect(second.files).toEqual([
      expect.objectContaining({ path: OPENWAGGLE_GLOBAL, status: 'already-migrated' }),
    ])
    expect(fs.json(MIGRATION_RECORD)).toEqual({
      version: 1,
      files: {
        [OPENWAGGLE_GLOBAL]: {
          version: 1,
          migratedAt: NOW.toISOString(),
          status: 'migrated',
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
      oauth: {},
      legacyProjects: [],
      legacyServerNames: expect.any(Object),
    })
  })
})
