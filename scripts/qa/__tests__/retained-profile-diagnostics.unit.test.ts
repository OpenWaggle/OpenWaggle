import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeLiveQaCleanup, RETAINED_RUNS_NOTE } from '../live-session-orchestration-lifecycle'
import { retainedProfileDiagnostics } from '../retained-profile-diagnostics'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-retained-profile-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('a retained live QA profile', () => {
  it('shows its Host and app log tails and its Session Host files', async () => {
    await fs.mkdir(path.join(root, 'logs'))
    const hostLog = Array.from({ length: 200 }, (_, line) => `host line ${String(line)}`)
    await fs.writeFile(
      path.join(root, 'logs', 'openwaggle-host-2026-11-15.log'),
      hostLog.join('\n'),
    )
    await fs.writeFile(path.join(root, 'logs', 'openwaggle-2026-11-15.log'), 'gui started\n')
    await fs.mkdir(path.join(root, 'session-host'))
    await fs.writeFile(path.join(root, 'session-host', 'local-user.credential'), 'x')

    const text = await retainedProfileDiagnostics(root, async () => 'processes:\n  "electron.exe"')

    expect(text).toContain('session-host/:\n  local-user.credential 1 B')
    expect(text).toContain('--- logs/openwaggle-2026-11-15.log (last 1 lines)\ngui started')
    expect(text).toContain('--- logs/openwaggle-host-2026-11-15.log (last 120 lines)')
    expect(text).toContain('host line 199')
    expect(text).not.toContain('host line 79\n')
    expect(text).toContain('processes:\n  "electron.exe"')
  })

  it('says which directories a Host never created', async () => {
    const text = await retainedProfileDiagnostics(root, null)

    expect(text).toBe('logs/: does not exist\nsession-host/: does not exist')
  })

  it('is printed with the GUI output when a run fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await completeLiveQaCleanup(
      {
        gui: null,
        guiLogs: [() => 'vite output'],
        passed: false,
        primaryFailure: null,
        userDataRoot: root,
      },
      {
        prepareProfileRemoval: vi.fn(),
        shutdownHost: vi.fn(async () => undefined),
        stopGui: vi.fn(async () => undefined),
        describeProfile: async () => '--- logs/openwaggle-host.log (last 1 lines)\nwaiting',
      },
    )

    expect(consoleError).toHaveBeenCalledWith(
      `Live QA data retained at ${root}\n${RETAINED_RUNS_NOTE}\nvite output\n--- logs/openwaggle-host.log (last 1 lines)\nwaiting`,
    )
    consoleError.mockRestore()
  })
})
