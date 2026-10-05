import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const emitter: { current: EventEmitter | null } = { current: null }
  return {
    emitter,
    broadcast: vi.fn(),
    checkForUpdates: vi.fn<() => Promise<unknown>>(async () => undefined),
    quitAndInstall: vi.fn(),
    recordAttempt: vi.fn(async (..._args: unknown[]) => undefined),
    settleAttempt: vi.fn<() => Promise<unknown>>(async () => null),
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@shared/build-identity-runtime', () => ({ BUILD_CHANNEL: 'beta' }))
vi.mock('electron-updater', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const emitter = new Emitter()
  mocks.emitter.current = emitter
  return {
    autoUpdater: Object.assign(emitter, {
      checkForUpdates: () => mocks.checkForUpdates(),
      quitAndInstall: (...args: unknown[]) => mocks.quitAndInstall(...args),
    }),
  }
})
vi.mock('../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => mocks.broadcast(...args),
}))
vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: vi.fn(),
}))
vi.mock('../update-install-attempt', () => ({
  recordUpdateInstallAttempt: (...args: unknown[]) => mocks.recordAttempt(...args),
  settleUpdateInstallAttempt: () => mocks.settleAttempt(),
  takeUpdateInstallAttempt: vi.fn(async () => null),
}))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  checkForUpdates,
  disposeAutoUpdater,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  isInstallingUpdate,
} from '../updater'

function emitter() {
  if (!mocks.emitter.current) throw new Error('autoUpdater emitter not initialized')
  return mocks.emitter.current
}

describe('Restart to update', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.settleAttempt.mockResolvedValue(null)
    emitter().removeAllListeners()
    disposeAutoUpdater()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeAutoUpdater()
    emitter().removeAllListeners()
  })

  it('shows the restart at once and records the attempt before handing over', async () => {
    const environment = { userDataDirectory: '/tmp/user-data', currentVersion: '1.2.2' }
    initAutoUpdater('stable', undefined, environment)
    emitter().emit('update-downloaded', { version: '1.2.3' })

    await installUpdate()

    expect(getUpdateStatus()).toEqual({ type: 'installing', version: '1.2.3' })
    expect(isInstallingUpdate()).toBe(true)
    expect(mocks.recordAttempt).toHaveBeenCalledWith('/tmp/user-data', {
      fromVersion: '1.2.2',
      toVersion: '1.2.3',
      attemptedAt: expect.any(Number),
    })
    expect(mocks.recordAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.quitAndInstall.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('keeps the installing state while the app quits, even through a re-check', async () => {
    initAutoUpdater('stable')
    emitter().emit('update-downloaded', { version: '1.2.3' })
    await installUpdate()
    mocks.broadcast.mockClear()

    checkForUpdates()
    emitter().emit('checking-for-update')
    emitter().emit('update-not-available')

    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.broadcast).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({ type: 'installing', version: '1.2.3' })
  })

  it('reports an installer error instead of looking like it is still restarting', async () => {
    initAutoUpdater('stable')
    emitter().emit('update-downloaded', { version: '1.2.3' })
    await installUpdate()

    emitter().emit('error', new Error('code signature mismatch'))

    expect(isInstallingUpdate()).toBe(false)
    // The app did not quit, so the download is still there: say why and offer it again.
    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure:
        'Version 1.2.3 could not be installed: code signature mismatch. Restart to update to try again.',
    })
  })

  it('explains why the last Restart to update did not install that version', async () => {
    mocks.settleAttempt.mockResolvedValue({
      type: 'failed',
      version: '1.2.3',
      message: 'Version 1.2.3 did not finish installing.',
    })
    initAutoUpdater('stable', undefined, {
      userDataDirectory: '/tmp/user-data',
      currentVersion: '1.2.2',
    })
    await vi.advanceTimersByTimeAsync(0)

    emitter().emit('update-downloaded', { version: '1.2.3' })
    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure: 'Version 1.2.3 did not finish installing.',
    })

    emitter().emit('update-downloaded', { version: '1.2.4' })
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '1.2.4' })
  })
})
