import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  whenReady: vi.fn(),
  exit: vi.fn(),
  flush: vi.fn(),
  configureStorage: vi.fn(),
}))

vi.mock('electron', () => ({ app: { whenReady: mocks.whenReady, exit: mocks.exit } }))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: { OPENWAGGLE_USER_DATA_DIR: '/user-data' } }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: mocks.configureStorage }))

import { startRecoveryCliIfRequested } from '../recovery-cli-entry'

describe('Recovery CLI entry failures', () => {
  let stderr: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.whenReady.mockRejectedValue(new Error('Electron failed to start.'))
    mocks.flush.mockResolvedValue(undefined)
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => stderr.mockRestore())

  it('preserves JSON output when startup fails before command parsing', async () => {
    expect(startRecoveryCliIfRequested(['recovery', 'status', '--json'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      error: { message: 'Electron failed to start.' },
    })
  })

  it('preserves JSON output when storage configuration fails synchronously', async () => {
    mocks.configureStorage.mockImplementationOnce(() => {
      throw new Error('Storage path is unavailable.')
    })
    expect(startRecoveryCliIfRequested(['recovery', 'status', '--json'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      error: { message: 'Storage path is unavailable.' },
    })
  })
})
