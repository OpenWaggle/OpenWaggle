import { describe, expect, it } from 'vitest'
import { McpFileSources } from '../file-computation'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { legacyMigrationBackupPath, migrationBackupPath } from '../migration-paths'
import { HOME, memoryFs, NOW, OPENWAGGLE_GLOBAL } from './migration-fixtures'

const PROJECT_FILE = '/work/app/.openwaggle/mcp.json'

describe('migration backups', () => {
  it('keeps a project backup in the user data and the global backup next to its file', async () => {
    const original = { mcpServers: { lint: { command: 'lint', required: true } } }
    const fs = memoryFs({ [OPENWAGGLE_GLOBAL]: original, [PROJECT_FILE]: original })

    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: ['/work/app'],
      now: () => NOW,
      fs,
    })

    expect(fs.files.has(`${PROJECT_FILE}.pre-adr-0048.bak`)).toBe(false)
    expect(fs.json(migrationBackupPath(PROJECT_FILE, HOME))).toEqual(original)
    expect(migrationBackupPath(PROJECT_FILE, HOME)).toMatch(
      /^\/home\/user\/\.openwaggle\/mcp\/backups\/app-[0-9a-f]{16}\/mcp\.json\.pre-adr-0048\.bak$/,
    )
    expect(fs.json(`${OPENWAGGLE_GLOBAL}.pre-adr-0048.bak`)).toEqual(original)
  })

  it('still reads a backup an earlier build left next to a project file', async () => {
    const old = { mcpServers: { lint: { command: 'lint' } } }
    const fs = memoryFs({ [PROJECT_FILE]: {}, [legacyMigrationBackupPath(PROJECT_FILE)]: old })

    const sources = new McpFileSources(fs, HOME, `${HOME}/.pi/agent`)

    expect(await sources.legacyConfig(PROJECT_FILE)).toEqual(old)
  })
})
