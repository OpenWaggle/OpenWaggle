import type * as ChildProcessModule from 'node:child_process'
import { ChildProcess } from 'node:child_process'
import type * as FsModule from 'node:fs'
import { devNull } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  readdirSync: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: mocks.spawn,
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  openSync: mocks.openSync,
  closeSync: mocks.closeSync,
  readdirSync: mocks.readdirSync,
}))
vi.mock('electron', () => ({}))
vi.mock('../env', () => ({ env: {}, getSafeChildEnv: () => ({}) }))

import { launchHeadlessBackgroundProcess } from '../desktop-ui'

const launch = { command: '/owned/electron', args: ['session-host-internal'], environment: {} }

describe('detached authority descriptor ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    mocks.openSync.mockReturnValue(17)
    mocks.readdirSync.mockReturnValue(['0', '1', '2', '3', '4'])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('replaces inherited Linux control descriptors without retaining the parent null handle', async () => {
    const child = new ChildProcess()
    const unref = vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    mocks.spawn.mockReturnValue(child)

    const pending = launchHeadlessBackgroundProcess(launch)

    expect(mocks.openSync).toHaveBeenCalledWith(devNull, 'r+')
    expect(mocks.spawn).toHaveBeenCalledWith(launch.command, launch.args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', ...Array.from({ length: 15 }, () => 17)],
      windowsHide: true,
      env: {},
    })
    expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(17)
    expect(unref).not.toHaveBeenCalled()
    child.emit('spawn')
    await expect(pending).resolves.toBeUndefined()
    expect(unref).toHaveBeenCalledOnce()
  })

  it('closes the null handle when spawn throws and preserves the launch failure', async () => {
    const failure = new Error('spawn failed')
    mocks.spawn.mockImplementation(() => {
      throw failure
    })

    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toBe(failure)
    expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(17)
  })

  it('rejects an asynchronous spawn failure after releasing the null handle', async () => {
    const child = new ChildProcess()
    const unref = vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    const failure = new Error('spawn rejected')
    mocks.spawn.mockReturnValue(child)

    const pending = launchHeadlessBackgroundProcess(launch)
    expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(17)
    child.emit('error', failure)

    await expect(pending).rejects.toBe(failure)
    expect(child.listenerCount('spawn')).toBe(0)
    expect(unref).not.toHaveBeenCalled()
  })

  it('maps and releases a null handle allocated as descriptor zero', async () => {
    const child = new ChildProcess()
    vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    mocks.openSync.mockReturnValueOnce(0).mockReturnValue(5)
    mocks.spawn.mockReturnValue(child)

    const pending = launchHeadlessBackgroundProcess(launch)
    expect(mocks.spawn).toHaveBeenCalledWith(launch.command, launch.args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 5, 5],
      windowsHide: true,
      env: {},
    })
    expect(mocks.closeSync.mock.calls).toEqual([[0], [5]])
    child.emit('spawn')
    await pending
  })

  it('fails before launching when the null device cannot be opened', async () => {
    const failure = new Error('null device unavailable')
    mocks.openSync.mockImplementation(() => {
      throw failure
    })

    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toBe(failure)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.closeSync).not.toHaveBeenCalled()
  })

  it('replaces higher Chromium descriptors and holes in the parent snapshot', async () => {
    const child = new ChildProcess()
    vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    mocks.spawn.mockReturnValue(child)
    mocks.readdirSync.mockReturnValue(['0', '1', '2', '3', '17', '65', '68'])
    mocks.openSync.mockReturnValueOnce(17).mockReturnValueOnce(18).mockReturnValue(69)

    const pending = launchHeadlessBackgroundProcess(launch)

    expect(mocks.readdirSync).toHaveBeenCalledWith('/proc/self/fd')
    expect(mocks.spawn).toHaveBeenCalledWith(launch.command, launch.args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', ...Array.from({ length: 66 }, () => 69)],
      windowsHide: true,
      env: {},
    })
    expect(mocks.closeSync.mock.calls).toEqual([[17], [18], [69]])
    child.emit('spawn')
    await pending
  })

  it('releases reserved null handles and fails closed if high-source reservation fails', async () => {
    const failure = new Error('no spare descriptors')
    mocks.readdirSync.mockReturnValue(['0', '1', '2', '50'])
    mocks.openSync
      .mockReturnValueOnce(17)
      .mockReturnValueOnce(18)
      .mockImplementation(() => {
        throw failure
      })

    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toBe(failure)

    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.closeSync.mock.calls).toEqual([[17], [18]])
  })

  it('releases the entire high-source reservation when spawn throws', async () => {
    const failure = new Error('spawn failed')
    mocks.readdirSync.mockReturnValue(['0', '1', '2', '50'])
    mocks.openSync.mockReturnValueOnce(17).mockReturnValueOnce(18).mockReturnValue(51)
    mocks.spawn.mockImplementation(() => {
      throw failure
    })

    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toBe(failure)

    expect(mocks.closeSync.mock.calls).toEqual([[17], [18], [51]])
  })

  it('releases intermediate reservations before spawn needs its own internal descriptors', async () => {
    const child = new ChildProcess()
    vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    mocks.readdirSync.mockReturnValue(['0', '1', '2', '62'])
    mocks.openSync.mockReturnValueOnce(17).mockReturnValueOnce(18).mockReturnValue(63)
    mocks.spawn.mockImplementation(() => {
      expect(mocks.closeSync.mock.calls).toEqual([[17], [18]])
      return child
    })

    const pending = launchHeadlessBackgroundProcess(launch)
    child.emit('spawn')

    await expect(pending).resolves.toBeUndefined()
    expect(mocks.closeSync.mock.calls).toEqual([[17], [18], [63]])
  })

  it('fails closed and releases the null handle when the descriptor snapshot is unavailable', async () => {
    const failure = new Error('proc unavailable')
    mocks.readdirSync.mockImplementation(() => {
      throw failure
    })

    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toBe(failure)

    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(17)
  })

  it.each(['-1', '3x', '1.5', '9007199254740992', '65536'])(
    'fails closed before allocation or spawn for invalid or excessive descriptor %s',
    async (descriptor) => {
      mocks.readdirSync.mockReturnValue(['0', '1', '2', descriptor])

      await expect(launchHeadlessBackgroundProcess(launch)).rejects.toThrow(
        'Cannot isolate detached process descriptors',
      )

      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(17)
    },
  )

  it.each(['darwin', 'win32'])('preserves the existing %s launch policy', async (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const child = new ChildProcess()
    vi.spyOn(child, 'unref').mockImplementation(() => undefined)
    mocks.spawn.mockReturnValue(child)

    const pending = launchHeadlessBackgroundProcess(launch)
    child.emit('spawn')
    await pending

    expect(mocks.spawn).toHaveBeenCalledWith(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {},
    })
    expect(mocks.openSync).not.toHaveBeenCalled()
    expect(mocks.readdirSync).not.toHaveBeenCalled()
  })
})
