import { describe, expect, it, vi } from 'vitest'
import {
  completeLiveQaCleanup,
  runLiveQaProfileLifecycle,
} from '../live-session-orchestration-lifecycle'
import { launchGui } from '../live-session-orchestration-support'

describe('live Session orchestration profile lifecycle', () => {
  it('drains and reports a retained profile when setup fails before GUI launch', async () => {
    const setupFailure = new Error('Host probe failed')
    const cleanup = vi.fn(async (input: Parameters<typeof completeLiveQaCleanup>[0]) => {
      await completeLiveQaCleanup(input, {
        prepareProfileRemoval: vi.fn(),
        shutdownHost: vi.fn(async () => undefined),
        stopGui: vi.fn(async () => undefined),
      })
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      runLiveQaProfileLifecycle({
        userDataRoot: '/tmp/openwaggle-retained-profile',
        state: { gui: null, guiLogs: [], passed: false },
        run: async () => {
          throw setupFailure
        },
        cleanup,
      }),
    ).rejects.toBe(setupFailure)

    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        gui: null,
        passed: false,
        primaryFailure: { error: setupFailure },
      }),
    )
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Live QA data retained at /tmp/openwaggle-retained-profile'),
    )
    consoleError.mockRestore()
  })

  it('aggregates setup and shutdown failures without attempting profile deletion', async () => {
    const setupFailure = new Error('skill disable failed')
    const shutdownFailure = new Error('Host drain failed')
    const prepareProfileRemoval = vi.fn()

    await expect(
      completeLiveQaCleanup(
        {
          gui: null,
          guiLogs: [],
          passed: false,
          primaryFailure: { error: setupFailure },
          userDataRoot: '/tmp/openwaggle-retained-profile',
        },
        {
          prepareProfileRemoval,
          shutdownHost: vi.fn(async () => {
            throw shutdownFailure
          }),
          stopGui: vi.fn(async () => undefined),
        },
      ),
    ).rejects.toMatchObject({
      errors: [setupFailure, shutdownFailure],
    })

    expect(prepareProfileRemoval).not.toHaveBeenCalled()
  })

  it('retains the profile when GUI exit cannot be proved', async () => {
    const gui = await launchGui(process.execPath, {}, ['-e', ''])
    const stopFailure = new Error('Could not prove GUI process exited')
    const prepareProfileRemoval = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      completeLiveQaCleanup(
        {
          gui,
          guiLogs: [gui.logs],
          passed: true,
          primaryFailure: null,
          userDataRoot: '/tmp/openwaggle-unproved-exit',
        },
        {
          prepareProfileRemoval,
          shutdownHost: vi.fn(async (_userDataRoot, whileHeld) => {
            await whileHeld({
              targetPath: '/tmp/openwaggle-unproved-exit/session-host.sqlite',
              release: async () => undefined,
            })
          }),
          stopGui: vi.fn(async () => {
            throw stopFailure
          }),
        },
      ),
    ).rejects.toBe(stopFailure)

    expect(prepareProfileRemoval).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Live QA data retained at /tmp/openwaggle-unproved-exit'),
    )
    consoleError.mockRestore()
  })
})
