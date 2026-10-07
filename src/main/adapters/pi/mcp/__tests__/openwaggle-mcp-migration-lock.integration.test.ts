import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { migrationRecordPath } from '../../../mcp/migration/migration-record'
import { withProcessFileLock } from '../../../mcp/process-file-lock'

// The shared setup gives this file a temporary HOME; the real migration runs against it here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({ projectPath: null, recentProjects: [], projectDisplayNames: {} }),
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  resolveMcpVaultSecret: async () => {
    throw new Error('no vault in this test')
  },
}))

const { migrateOpenWaggleMcpFilesOnce } = await import('../openwaggle-mcp-migration')

describe('the MCP file migration across Host processes', () => {
  it('waits while another process holds the migration lock', async () => {
    const globalFile = path.join(homedir(), '.openwaggle', 'mcp.json')
    mkdirSync(path.dirname(globalFile), { recursive: true })
    writeFileSync(
      globalFile,
      JSON.stringify({ mcpServers: { fs: { command: 'fs', directTools: true } } }),
    )
    const recordPath = migrationRecordPath(homedir())
    const released = Promise.withResolvers<void>()
    const otherHost = withProcessFileLock(recordPath, () => released.promise)
    await vi.waitFor(() => expect(existsSync(`${recordPath}.lock`)).toBe(true))

    const migration = migrateOpenWaggleMcpFilesOnce(null)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(existsSync(recordPath)).toBe(false)

    released.resolve()
    await otherHost
    await migration
    expect(existsSync(recordPath)).toBe(true)
  })
})
