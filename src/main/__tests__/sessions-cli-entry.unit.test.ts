import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(async () => {
    const { LocalSessionHostUnavailableError } = await import(
      '../session-host/local-session-client-protocol-error'
    )
    throw new LocalSessionHostUnavailableError('session host unavailable')
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

import { startHiveCliIfRequested } from '../sessions-cli-entry'

describe('Hive CLI Electron entrypoint errors', () => {
  beforeEach(() => {
    mocks.exit.mockClear()
    mocks.flush.mockClear()
    mocks.run.mockClear()
    mocks.whenReady.mockClear()
  })

  it.each([
    {
      args: ['hive', 'list'],
      expected: 'error [host_unavailable]: session host unavailable\n',
    },
    {
      args: ['hive', 'delegations-list', '--json'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"session host unavailable"}}\n',
    },
    {
      args: ['hive', 'events', '--jsonl'],
      expected:
        '{"schemaVersion":1,"type":"error","error":{"kind":"host_unavailable","message":"session host unavailable"}}\n',
    },
  ])('preserves the requested output mode for $args', async ({ args, expected }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startHiveCliIfRequested(args)).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(8))

    expect(stderr).toHaveBeenCalledWith(expected)
    stderr.mockRestore()
  })

  it.each([['sessions', 'list'], ['delegations', 'list'], ['sessions']])(
    'does not accept the former group in %j (ADR 0053)',
    (...args) => {
      expect(startHiveCliIfRequested(args)).toBe(false)
      expect(mocks.run).not.toHaveBeenCalled()
    },
  )
})
