import { describe, expect, it, vi } from 'vitest'

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.0.0-beta.25', on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('../local-session-cli-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local-session-cli-client')>()),
  createLocalSessionCliClientInput: createClientMock,
}))

const { runUpdateCli } = await import('../update-cli')
const { CliError } = await import('../cli-error')

describe('openwaggle update error kinds (#351)', () => {
  it('refuses an agent Run with the authorization exit code and an update-specific message', async () => {
    createClientMock.mockRejectedValueOnce(
      new CliError('authorization', 'OpenWaggle agents cannot check for or install updates.'),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 4, updaterOwnsExit: false })
    expect(createClientMock).toHaveBeenCalledWith(expect.anything(), {
      agentRefusal: expect.stringContaining('Ask the user to run openwaggle update'),
    })
    expect(stderr).toHaveBeenCalledWith(
      'error [authorization]: OpenWaggle agents cannot check for or install updates.\n',
    )
    stderr.mockRestore()
  })
})
