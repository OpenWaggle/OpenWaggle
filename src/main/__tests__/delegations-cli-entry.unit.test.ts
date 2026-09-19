import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(async () => 0),
  whenReady: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: { exit: mocks.exit, whenReady: mocks.whenReady },
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))
vi.mock('../delegations-cli', () => ({ runDelegationsCli: mocks.run }))

import { startDelegationsCliIfRequested } from '../delegations-cli-entry'

describe('Delegations CLI Electron entrypoint errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.whenReady.mockRejectedValue(new Error('Session Host unavailable.'))
  })

  it.each([
    {
      args: ['delegations', 'list'],
      expected: 'error [host_unavailable]: Session Host unavailable.\n',
    },
    {
      args: ['delegations', 'list', '--json'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"Session Host unavailable."}}\n',
    },
  ])('preserves the requested error format for $args', async ({ args, expected }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startDelegationsCliIfRequested(args)).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(8))

    expect(stderr).toHaveBeenCalledWith(expected)
    expect(mocks.flush).toHaveBeenCalledOnce()
    stderr.mockRestore()
  })
})
