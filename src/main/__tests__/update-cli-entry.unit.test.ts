import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configureStorage: vi.fn(),
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(),
  whenReady: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: { exit: mocks.exit, whenReady: mocks.whenReady },
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: { OPENWAGGLE_USER_DATA_DIR: '/tmp/openwaggle-update-test' } }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: mocks.configureStorage }))
vi.mock('../update-cli', () => ({ runUpdateCli: mocks.run }))

import { startUpdateCliIfRequested } from '../update-cli-entry'

describe('Update CLI Electron entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores other commands', () => {
    expect(startUpdateCliIfRequested(['sessions', 'list'])).toBe(false)
    expect(mocks.configureStorage).not.toHaveBeenCalled()
  })

  it('forwards update arguments and exits after ordinary commands', async () => {
    mocks.run.mockResolvedValue({ exitCode: 2, updaterOwnsExit: false })

    expect(startUpdateCliIfRequested(['update', '--channel', 'alpha'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(2))

    expect(mocks.run).toHaveBeenCalledWith(['--channel', 'alpha'])
    expect(mocks.flush).toHaveBeenCalledOnce()
  })

  it('leaves process exit to the updater after installation starts', async () => {
    mocks.run.mockResolvedValue({ exitCode: 0, updaterOwnsExit: true })

    expect(startUpdateCliIfRequested(['update'])).toBe(true)
    await vi.waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce())

    expect(mocks.exit).not.toHaveBeenCalled()
  })
})
