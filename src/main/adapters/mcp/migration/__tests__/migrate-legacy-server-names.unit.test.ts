import { describe, expect, it } from 'vitest'
import { mcpServerIdentity } from '../../pool/mcp-server-identity'
import { readLegacyMcpServerIdentities, readLegacyMcpServerNames } from '../legacy-server-names'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  HOME,
  LEGACY_STATE,
  legacyState,
  MIGRATION_RECORD,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
  oldIdentityKey,
} from './migration-fixtures'

const PROJECT = '/work/app'
const PROJECT_MCP_JSON = `${PROJECT}/.mcp.json`
const PROJECT_FILE = `${PROJECT}/.openwaggle/mcp.json`

describe('the old MCP instance IDs', () => {
  it('records which server name each old instance ID stood for', async () => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: { github: { command: 'github-mcp' } } },
      [PROJECT_MCP_JSON]: { mcpServers: { lint: { command: 'lint-mcp' } } },
      [PROJECT_FILE]: { mcpServers: { docs: { command: 'docs-mcp' } } },
      [LEGACY_STATE]: legacyState({
        servers: {
          [oldIdentityKey(OPENWAGGLE_GLOBAL, 'github')]: {
            instanceId: 'gh-1',
            enabled: true,
            trustedConfigHash: 'old-github-hash',
          },
          [oldIdentityKey(PROJECT_MCP_JSON, 'lint')]: { instanceId: 'lint-1', enabled: false },
          [oldIdentityKey(PROJECT_FILE, 'docs')]: { instanceId: 'docs-1', enabled: true },
        },
      }),
    })

    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [PROJECT], now: () => NOW, fs })

    expect(fs.json(MIGRATION_RECORD)).toMatchObject({
      legacyServerNames: { 'gh-1': 'github', 'lint-1': 'lint', 'docs-1': 'docs' },
    })
    // What an MCP App from before the upgrade is checked against: the hash it opened with, and
    // the identity of what the old entry ran.
    expect(Object.fromEntries(await readLegacyMcpServerIdentities(HOME, fs))).toEqual({
      'gh-1': {
        configHash: 'old-github-hash',
        identity: mcpServerIdentity('github', { command: 'github-mcp', args: [] }),
      },
      'lint-1': { identity: mcpServerIdentity('lint', { command: 'lint-mcp', args: [] }) },
      'docs-1': { identity: mcpServerIdentity('docs', { command: 'docs-mcp', args: [] }) },
    })
    expect(Object.fromEntries(await readLegacyMcpServerNames(HOME, fs))).toEqual({
      'gh-1': 'github',
      'lint-1': 'lint',
      'docs-1': 'docs',
    })
  })

  it('reads no names when the migration never ran', async () => {
    expect((await readLegacyMcpServerNames(HOME, memoryFs({}))).size).toBe(0)
  })
})
