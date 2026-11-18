import { describe, expect, it, vi } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  HOME,
  LEGACY_STATE,
  legacyState,
  memoryFs,
  NOW,
  recordingLogger,
} from './migration-fixtures'

const OLD_SWITCHES = {
  'session-off': 'off',
  'session-on': 'on',
  'session-inherit': 'inherit',
  'session-also-off': 'off',
}

function oldState() {
  return memoryFs({
    [LEGACY_STATE]: legacyState({ globalState: 'on', sessionStates: OLD_SWITCHES }),
  })
}

function migrate(
  fs: ReturnType<typeof memoryFs>,
  sessionMcpSwitch?: (sessionId: string) => Promise<void>,
) {
  return migrateOpenWaggleMcpFiles({
    homeDir: HOME,
    projectPaths: [],
    now: () => NOW,
    fs,
    logger: recordingLogger(),
    ...(sessionMcpSwitch ? { sessionMcpSwitch } : {}),
  })
}

describe('migrating the old per-Session MCP switches', () => {
  it('switches MCP off once for every Session the old state had off', async () => {
    const fs = oldState()
    const sessionMcpSwitch = vi.fn(async (_sessionId: string) => undefined)

    const first = await migrate(fs, sessionMcpSwitch)
    const second = await migrate(fs, sessionMcpSwitch)

    expect(sessionMcpSwitch.mock.calls).toEqual([['session-off'], ['session-also-off']])
    // 'on' and 'inherit' are what every Session is now, so they carry nothing over.
    expect(first.droppedSessionStates).toBe(2)
    expect(second.droppedSessionStates).toBe(2)
  })

  it('tries a Session again on the next start when writing its switch failed', async () => {
    const fs = oldState()
    const failing = vi.fn(async (sessionId: string) => {
      if (sessionId === 'session-off') throw new Error('database busy')
    })
    const working = vi.fn(async (_sessionId: string) => undefined)

    const first = await migrate(fs, failing)
    await migrate(fs, working)

    expect(first.droppedSessionStates).toBe(3)
    expect(working.mock.calls).toEqual([['session-off']])
  })

  it('records nothing when there is no store to write to', async () => {
    const fs = oldState()
    const sessionMcpSwitch = vi.fn(async (_sessionId: string) => undefined)

    const first = await migrate(fs)
    await migrate(fs, sessionMcpSwitch)

    expect(first.droppedSessionStates).toBe(4)
    expect(sessionMcpSwitch).toHaveBeenCalledTimes(2)
  })
})
