import { describe, expect, it, vi } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { HOME, LEGACY_STATE, legacyState, memoryFs, NOW } from './migration-fixtures'

const PROJECT = '/work/app'
const PROJECT_FILE = `${PROJECT}/.openwaggle/mcp.json`

describe("the migration's known projects", () => {
  it('are asked for once per run', async () => {
    const fs = memoryFs({ [LEGACY_STATE]: legacyState({ globalState: 'on' }) })
    const knownProjectPaths = vi.fn(async () => [PROJECT])

    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [PROJECT],
      knownProjectPaths,
      now: () => NOW,
      fs,
    })

    expect(knownProjectPaths).toHaveBeenCalledOnce()
  })

  it('only lend spellings later, so a failure to list them stops nothing', async () => {
    const fs = memoryFs({
      [LEGACY_STATE]: legacyState({ globalState: 'on' }),
      [PROJECT_FILE]: { mcpServers: { lint: { command: 'lint-mcp', directTools: true } } },
    })
    // The first run decides which projects keep their old on/off state.
    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [PROJECT],
      knownProjectPaths: async () => {
        throw new Error('database is locked')
      },
      now: () => NOW,
      fs,
    })

    expect(report.error).toBeUndefined()
    expect(report.files.find((file) => file.path === PROJECT_FILE)?.status).toBe('migrated')
  })
})
