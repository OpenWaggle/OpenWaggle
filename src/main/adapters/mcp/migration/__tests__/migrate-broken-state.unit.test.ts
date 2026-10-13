import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { forgetMcpFileMigrationOutcomes, pendingMcpFileMigration } from '../migration-health'
import {
  HOME,
  LEGACY_STATE,
  legacyState,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
} from './migration-fixtures'

const KEPT = '/work/kept'
const LATER = '/work/later'

afterEach(() => {
  forgetMcpFileMigrationOutcomes()
})

function setUp(sessionStates: Record<string, string> = {}) {
  const fs = memoryFs({
    [OPENWAGGLE_GLOBAL]: { mcpServers: { g: { command: 'g' } } },
    [LEGACY_STATE]: legacyState({ globalState: 'on', sessionStates }),
    [`${LATER}/.mcp.json`]: { mcpServers: { later: { command: 'later' } } },
  })
  const sink = vi.fn(async () => undefined)
  const migrate = (projectPaths: readonly string[]) =>
    migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths,
      now: () => NOW,
      fs,
      sessionMcpSwitch: sink,
    })
  const breakState = () => fs.files.set(LEGACY_STATE, '{ "version": 1,')
  return { fs, sink, migrate, breakState }
}

describe('a state.json that breaks after the first run', () => {
  it('lets a project opened later migrate without it, as it keeps no old state', async () => {
    const { migrate, breakState } = setUp()
    await migrate([KEPT])
    breakState()

    const report = await migrate([LATER])

    expect(report.error).toBeUndefined()
    expect(report.files.find((file) => file.path === `${LATER}/.openwaggle/mcp.json`)?.status).toBe(
      'unchanged',
    )
    expect(pendingMcpFileMigration(HOME, LATER)).toBeUndefined()
  })

  it('is reported and tried again while an old MCP-off Session switch is still to carry over', async () => {
    const { sink, migrate, breakState } = setUp({ s1: 'off' })
    // The Host database could not take the switch on the first run.
    sink.mockRejectedValueOnce(new Error('database is locked'))
    await migrate([])
    breakState()

    const report = await migrate([])

    expect(report.error).toContain(LEGACY_STATE)
  })

  it('is ignored once every old Session switch was carried over', async () => {
    const { migrate, breakState } = setUp({ s1: 'off' })
    await migrate([])
    breakState()

    const report = await migrate([])

    expect(report.error).toBeUndefined()
  })
})
