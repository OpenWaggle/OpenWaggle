import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const env: { OPENWAGGLE_USER_DATA_DIR?: string } = {}
  return {
    /** Electron's app paths, as `setPath` and `setAppLogsPath` leave them. */
    paths: new Map<string, string>(),
    env,
    initFileLogger: vi.fn(async () => undefined),
  }
})

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn((name: string) => mocks.paths.get(name) ?? '/default/profile'),
    setPath: vi.fn((name: string, value: string) => mocks.paths.set(name, value)),
    setAppLogsPath: vi.fn((value: string) => mocks.paths.set('logs', value)),
    getVersion: vi.fn(() => '1.0.0'),
    whenReady: vi.fn(async () => undefined),
    setActivationPolicy: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}))
vi.mock('../env', () => ({
  env: mocks.env,
  installDesktopShellEnvironment: async () => undefined,
}))
vi.mock('../logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../logger')>()),
  initFileLogger: mocks.initFileLogger,
}))
// Startup stops after the log file opens; only where it opens matters here.
vi.mock('../session-host/local-session-paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session-host/local-session-paths')>()),
  resolveLocalSessionHostPaths: vi.fn(() => ({})),
  prepareLocalSessionHostPaths: vi.fn(() => new Promise(() => undefined)),
}))
vi.mock('../runtime', () => ({}))
vi.mock('../store/settings', () => ({}))
vi.mock('../usage-statistics/usage-statistics-recorder')

import { startSessionHostCliIfRequested } from '../session-host-cli-entry'

let userDataPath = ''

afterEach(async () => {
  mocks.env.OPENWAGGLE_USER_DATA_DIR = undefined
  mocks.paths.clear()
  await rm(userDataPath, { recursive: true, force: true })
})

// QA and test runs point the Host at a scratch profile; its log file must stay inside it.
it('writes the Session Host log file inside a profile OPENWAGGLE_USER_DATA_DIR points at', async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'openwaggle-host-logs-'))
  mocks.env.OPENWAGGLE_USER_DATA_DIR = userDataPath

  expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)

  await vi.waitFor(() =>
    expect(mocks.initFileLogger).toHaveBeenCalledWith(
      join(userDataPath, 'logs'),
      'openwaggle-host',
    ),
  )
})
