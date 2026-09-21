import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  flush: vi.fn(async () => undefined),
  run: vi.fn(async () => {
    throw new Error('agent entry failed')
  }),
  whenReady: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  app: { exit: mocks.exit, whenReady: mocks.whenReady },
}))
vi.mock('../agents-cli', () => ({ runAgentsCli: mocks.run }))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: mocks.flush }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))

import { startAgentsCliIfRequested } from '../agents-cli-entry'

describe('Agent CLI Electron entrypoint errors', () => {
  beforeEach(() => {
    mocks.exit.mockClear()
    mocks.flush.mockClear()
    mocks.run.mockClear()
    mocks.whenReady.mockClear()
  })

  it.each([
    { args: ['agents', 'list'], expected: 'error: agent entry failed\n' },
    {
      args: ['agents', 'list', '--json'],
      expected: '{"schemaVersion":1,"error":{"message":"agent entry failed"}}\n',
    },
  ])('preserves the requested output mode for $args', async ({ args, expected }) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startAgentsCliIfRequested(args)).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))

    expect(stderr).toHaveBeenCalledWith(expected)
    stderr.mockRestore()
  })
})
