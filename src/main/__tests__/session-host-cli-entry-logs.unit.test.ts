import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const env: { OPENWAGGLE_USER_DATA_DIR?: string } = {}
  return {
    env,
    initFileLogger: vi.fn(async () => undefined),
  }
})

// The fake keeps `userData` and `logs` as `setUserData` and `setLogs` leave them.
vi.mock('../desktop-shell/app-paths', async () => ({
  appPaths: (await import('../test-support/fake-desktop-shell')).fakeAppPaths('/default/profile'),
}))
vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle(),
}))
vi.mock('../desktop-shell/system-integration', async () => ({
  systemIntegration: (await import('../test-support/fake-desktop-shell')).fakeSystemIntegration(),
}))
vi.mock('../desktop-shell/desktop-windows', () => ({
  desktopWindows: { installWindowPolicy: vi.fn() },
}))

vi.mock('../env', () => ({
  env: mocks.env,
  installLinuxSessionBusEnvironment: () => undefined,
  takeShellEnvironmentRefreshedSince: () => undefined,
}))
vi.mock('../desktop-shell-environment-process', () => ({
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
  delete mocks.env.OPENWAGGLE_USER_DATA_DIR
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
