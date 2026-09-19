import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(async () => {
    throw new Error('Session Host unavailable')
  }),
  whenReady: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({ app: { exit: mocks.exit, whenReady: mocks.whenReady } }))
vi.mock('../access-cli', () => ({ runAccessCli: mocks.run }))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))

import { startAccessCliIfRequested } from '../access-cli-entry'

describe('Access CLI Electron entrypoint errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      args: ['access', 'profiles', 'list'],
      expected: 'error [host_unavailable]: Session Host unavailable\n',
    },
    {
      args: ['access', 'profiles', 'list', '--json'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"Session Host unavailable"}}\n',
    },
  ])('preserves the requested output mode for $args', async ({ args, expected }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startAccessCliIfRequested(args)).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(8))

    expect(stderr).toHaveBeenCalledWith(expected)
    stderr.mockRestore()
  })
})
