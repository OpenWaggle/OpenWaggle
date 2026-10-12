import { describe, expect, it } from 'vitest'
import { mcpWriteRefusal } from '../../config/mcp-write-refusal'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { pendingMcpFileMigration } from '../migration-health'
import { migrationRecordPath } from '../migration-record'
import { HOME, LEGACY_STATE, memoryFs, NOW, OPENWAGGLE_GLOBAL } from './migration-fixtures'

describe('a migration that cannot read its record or the old state', () => {
  it.each([
    ['the old state', LEGACY_STATE, 'Invalid OpenWaggle MCP state at'],
    ['its record', migrationRecordPath(HOME), 'Invalid OpenWaggle MCP migration record at'],
  ])('names %s as the file to fix', async (_what, broken, wording) => {
    const fs = memoryFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: { old: { command: 'old-mcp' } } },
      [broken]: '{ "version": 1,',
    })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
    })

    expect(report.error).toContain(`${wording} ${broken}`)
    const pending = pendingMcpFileMigration(HOME, null)
    expect(pending).toMatchObject({ path: OPENWAGGLE_GLOBAL, source: broken })
    const message = mcpWriteRefusal(pending)?.message ?? ''
    expect(message).toContain(`Fix it: ${wording} ${broken}`)
    // Named once, though both the instruction and the error point at it.
    expect(message.split(broken)).toHaveLength(2)
  })
})
