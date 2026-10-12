import { homedir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
// The scope is closed while its migration waits: no server is loaded.
vi.mock('../../../mcp/config/mcp-runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../mcp/config/mcp-runtime-config')>()),
  loadMcpRuntimeConfig: async () => ({
    loaded: { servers: [], errors: [] },
    merged: { servers: [], errors: [], incomplete: true },
    transports: new Map(),
    unavailable: new Map(),
    missingSecrets: new Map(),
    connectionConfigs: new Map(),
  }),
}))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')
const { recordMcpFileMigrationOutcome } = await import('../../../mcp/migration/migration-health')

const globalFile = () => path.join(homedir(), '.openwaggle', 'mcp.json')

afterEach(() => {
  recordMcpFileMigrationOutcome(globalFile())
})

describe('Check connection while the scope waits for its migration', () => {
  it('fails with the reason, not "No MCP server named"', async () => {
    recordMcpFileMigrationOutcome(globalFile(), 'the migration lock is held', { cause: 'wait' })

    const inspection = await inspectMcpServer(
      { projectPath: null, name: 'docs' },
      { homeDir: homedir(), piAgentDir: '/home/user/.pi/agent' },
    )

    expect(inspection.state).toBe('failed')
    expect(inspection.error).toContain('the migration lock is held')
    expect(inspection.error).not.toContain('No MCP server named')
  })
})
