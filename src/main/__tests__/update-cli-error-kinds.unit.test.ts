import { describe, expect, it, vi } from 'vitest'

const { createClientMock, env, fetchMock } = vi.hoisted(() => {
  const environment: { OPENWAGGLE_AGENT_RUN?: '1' } = {}
  return { createClientMock: vi.fn(), env: environment, fetchMock: vi.fn() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.0.0-beta.25', on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('../env', () => ({ env }))
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

  it.each([
    [['--channel', 'alpha', '--check']],
    [['--version', '99.0.0', '--check']],
    [['--version', '99.0.0']],
  ])(
    'refuses an agent Run on the Host-free path %j before checking or downloading',
    async (args) => {
      env.OPENWAGGLE_AGENT_RUN = '1'
      vi.stubGlobal('fetch', fetchMock)
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      await expect(runUpdateCli(args)).resolves.toEqual({ exitCode: 4, updaterOwnsExit: false })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledWith(
        'error [authorization]: OpenWaggle agents cannot check for or install OpenWaggle updates. Ask the user to run openwaggle update.\n',
      )
      stderr.mockRestore()
      vi.unstubAllGlobals()
      env.OPENWAGGLE_AGENT_RUN = undefined
    },
  )
})
