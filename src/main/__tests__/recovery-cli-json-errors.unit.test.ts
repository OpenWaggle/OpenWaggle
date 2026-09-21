import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  fence: vi.fn(),
  stdout: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../cli-stdout', () => ({ writeCliStdout: mocks.stdout }))
vi.mock('../session-host/local-session-paths', () => ({
  resolveLocalSessionHostPaths: () => ({ databasePath: '/user-data/session-host.sqlite' }),
}))
vi.mock('../session-host/legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: mocks.fence,
}))
vi.mock('../session-host/session-host-recovery', () => ({
  sessionHostRecoveryStatus: mocks.status,
  restorePreCutoverDatabase: mocks.restore,
  deletePreCutoverDatabase: mocks.remove,
}))

import { runRecoveryCli } from '../recovery-cli'

function expectJsonError(stderr: ReturnType<typeof vi.spyOn>, message: string) {
  const output = stderr.mock.calls[0]?.[0]
  expect(typeof output).toBe('string')
  expect(JSON.parse(String(output))).toEqual({ schemaVersion: 1, error: { message } })
}

describe('Recovery CLI JSON failures', () => {
  let stderr: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.stdout.mockResolvedValue(undefined)
    mocks.fence.mockImplementation(async (action) => action())
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => stderr.mockRestore())

  it('emits JSON for option validation and missing confirmation', async () => {
    expect(await runRecoveryCli(['status', '--yes', '--json'])).toBe(2)
    expectJsonError(stderr, 'Unsupported option for OpenWaggle Recovery status: --yes.')

    stderr.mockClear()
    expect(await runRecoveryCli(['restore-pre-cutover', '--json'])).toBe(2)
    expectJsonError(stderr, 'This operation requires explicit --yes confirmation.')
  })

  it('emits JSON when recovery status cannot read the filesystem', async () => {
    mocks.status.mockRejectedValue(new Error('Recovery copy is unreadable.'))
    expect(await runRecoveryCli(['status', '--json'])).toBe(1)
    expectJsonError(stderr, 'Recovery copy is unreadable.')
  })

  it('emits JSON for restore ownership and delete failures', async () => {
    mocks.fence.mockRejectedValueOnce(new Error('Session Host still owns the database.'))
    expect(await runRecoveryCli(['restore-pre-cutover', '--yes', '--json'])).toBe(1)
    expectJsonError(stderr, 'Session Host still owns the database.')

    stderr.mockClear()
    mocks.remove.mockRejectedValueOnce(new Error('Recovery copy cannot be deleted.'))
    expect(await runRecoveryCli(['delete-pre-cutover', '--yes', '--json'])).toBe(1)
    expectJsonError(stderr, 'Recovery copy cannot be deleted.')
  })

  it('keeps plaintext errors for non-JSON requests', async () => {
    mocks.status.mockRejectedValue(new Error('Recovery copy is unreadable.'))
    expect(await runRecoveryCli(['status'])).toBe(1)
    expect(stderr).toHaveBeenCalledWith('error: Recovery copy is unreadable.\n')
  })
})
