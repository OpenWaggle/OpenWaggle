import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(async () => {
    throw new Error('session host unavailable')
  }),
  whenReady: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: { exit: mocks.exit, whenReady: mocks.whenReady },
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))
vi.mock('../sessions-cli', () => ({ runSessionsCli: mocks.run }))

import { startSessionsCliIfRequested } from '../sessions-cli-entry'

describe('Sessions CLI Electron entrypoint errors', () => {
  beforeEach(() => {
    mocks.exit.mockClear()
    mocks.flush.mockClear()
    mocks.run.mockClear()
    mocks.whenReady.mockClear()
  })

  it.each([
    {
      args: ['sessions', 'list'],
      expected: 'error [host_unavailable]: session host unavailable\n',
    },
    {
      args: ['sessions', 'list', '--json'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"session host unavailable"}}\n',
    },
    {
      args: ['sessions', 'events', '--jsonl'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"session host unavailable"}}\n',
    },
  ])('preserves the requested output mode for $args', async ({ args, expected }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startSessionsCliIfRequested(args)).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))

    expect(stderr).toHaveBeenCalledWith(expected)
    stderr.mockRestore()
  })
})
