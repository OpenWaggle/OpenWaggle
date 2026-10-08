import { fromPartial } from '@total-typescript/shoehorn'
import { Context, Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Admission from '../desktop-native-admission'
import { DesktopNativeRecoveryUnavailableError } from '../desktop-native-admission'
import { startAppGuiDesktopServices } from '../gui-desktop-services'
import { BrowserPreviewAutomationService } from '../ports/browser-preview-automation-service'
import { TerminalService } from '../ports/terminal-service'
import {
  DESKTOP_SHUTDOWN_DRAIN_MS,
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
} from '../session-host/gui-desktop-service-lifecycle'
import type { LocalSessionHostPaths } from '../session-host/local-session-paths'

const mocks = vi.hoisted(() => {
  const events: string[] = []
  return {
    events,
    startBridge: vi.fn(),
    makeExecutor: vi.fn((..._args: unknown[]) => ({})),
    stop: vi.fn(),
    markClosed: vi.fn(),
    closeTerminals: vi.fn(),
    closeBrowsers: vi.fn(),
    disposeRuntime: vi.fn(),
    beginShutdown: vi.fn(),
    quarantine: vi.fn((..._args: unknown[]) => {}),
    attachment: vi.fn((): 'attached' | 'reconnecting' | 'stopped' => 'attached'),
  }
})
vi.mock('../browser-preview', () => ({
  browserPreviewManager: {
    closeForOwner: vi.fn(),
    acquireMutationFence: vi.fn(),
    beginShutdown: () => mocks.beginShutdown(),
    closeAll: () => mocks.closeBrowsers(),
  },
}))
vi.mock('../desktop-native-admission', async () => ({
  DesktopNativeRecoveryUnavailableError: (
    await vi.importActual<typeof Admission>('../desktop-native-admission')
  ).DesktopNativeRecoveryUnavailableError,
  quarantineDesktopNativeAdmission: (...args: unknown[]) => mocks.quarantine(...args),
}))
vi.mock('../session-host/gui-desktop-service-executor', () => ({
  makeGuiDesktopServiceExecutor: (...args: unknown[]) => mocks.makeExecutor(...args),
}))
vi.mock('../session-host/gui-desktop-service-bridge', async () => ({
  ...(await import('../session-host/gui-desktop-service-lifecycle')),
  startGuiDesktopServiceBridge: (...args: unknown[]) => mocks.startBridge(...args),
}))

function input() {
  const context = Context.make(
    TerminalService,
    fromPartial({ closeAll: () => Effect.promise(() => mocks.closeTerminals()) }),
  ).pipe(Context.add(BrowserPreviewAutomationService, fromPartial({})))
  return {
    client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
    runEffect: <A, E>(
      effect: Effect.Effect<A, E, TerminalService | BrowserPreviewAutomationService>,
    ) => Effect.runPromise(Effect.provide(effect, context)),
    disposeRuntime: () => mocks.disposeRuntime(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.events.splice(0)
  mocks.stop.mockImplementation(async () => {
    mocks.events.push('stop')
  })
  mocks.markClosed.mockImplementation(async () => {
    mocks.events.push('receipt')
  })
  mocks.closeTerminals.mockImplementation(async () => {
    mocks.events.push('terminals')
  })
  mocks.closeBrowsers.mockImplementation(async () => {
    mocks.events.push('browsers')
  })
  mocks.disposeRuntime.mockImplementation(async () => {
    mocks.events.push('runtime')
  })
  mocks.beginShutdown.mockImplementation(() => {
    mocks.events.push('admission-closed')
  })
  mocks.attachment.mockReturnValue('attached')
  mocks.startBridge.mockResolvedValue({
    stop: mocks.stop,
    markClosed: mocks.markClosed,
    attachment: mocks.attachment,
  })
})

describe('desktop tools recovery wiring', () => {
  it('offers a user-attested recovery that attaches and later closes cleanly', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    await offeredRecovery()()
    expect(mocks.startBridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ recoverPreviousOwner: true }),
    )
    await cleanup()
    expect(mocks.events).toEqual([
      'stop',
      'admission-closed',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
  })

  it('lets a later click succeed once a partially recovered lifecycle reattaches', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    const recover = offeredRecovery()
    mocks.attachment.mockReturnValue('reconnecting')
    mocks.startBridge.mockRejectedValueOnce(
      new DesktopServiceAttachmentError(
        { stop: mocks.stop, markClosed: mocks.markClosed, attachment: mocks.attachment },
        new Error('ready failed'),
      ),
    )
    await expect(recover()).rejects.toThrow('still reconnecting')
    await expect(recover()).rejects.toThrow('still reconnecting')
    mocks.attachment.mockReturnValue('attached')
    await recover()
    // No second bridge is ever started for the same executor.
    expect(mocks.startBridge).toHaveBeenCalledTimes(2)
    await cleanup()
    expect(mocks.events).toEqual([
      'stop',
      'admission-closed',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
  })

  it('stops and closes a bridge whose recovery finishes after quit cleanup began', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    const started = Promise.withResolvers<unknown>()
    mocks.startBridge.mockReturnValueOnce(started.promise)
    const recovering = offeredRecovery()()
    const quitting = cleanup()
    await Promise.resolve()
    expect(mocks.events).toEqual([])
    started.resolve({
      stop: mocks.stop,
      markClosed: mocks.markClosed,
      attachment: mocks.attachment,
    })
    // The window is quitting, so the late success is not reported as usable desktop tools.
    await expect(recovering).rejects.toThrow('OpenWaggle is quitting')
    await quitting
    expect(mocks.events).toEqual([
      'stop',
      'admission-closed',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
  })

  it('keeps recovery available after a quit that failed to stop the bridge', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    const recover = offeredRecovery()
    mocks.attachment.mockReturnValue('reconnecting')
    mocks.startBridge.mockRejectedValueOnce(
      new DesktopServiceAttachmentError(
        { stop: mocks.stop, markClosed: mocks.markClosed, attachment: mocks.attachment },
        new Error('ready failed'),
      ),
    )
    await expect(recover()).rejects.toThrow('still reconnecting')
    mocks.stop.mockRejectedValueOnce(new Error('Desktop mutations did not drain before shutdown.'))
    await expect(cleanup()).rejects.toThrow('did not drain')
    mocks.attachment.mockReturnValue('attached')
    await expect(recover()).resolves.toBeUndefined()
  })

  it('refuses, retryably, to start a recovery while quit is stopping the bridge', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    const recover = offeredRecovery()
    mocks.attachment.mockReturnValue('reconnecting')
    mocks.startBridge.mockRejectedValueOnce(
      new DesktopServiceAttachmentError(
        { stop: mocks.stop, markClosed: mocks.markClosed, attachment: mocks.attachment },
        new Error('ready failed'),
      ),
    )
    await expect(recover()).rejects.toThrow('still reconnecting')
    const stopping = Promise.withResolvers<void>()
    mocks.stop.mockReturnValueOnce(stopping.promise)
    const quitting = cleanup()
    await Promise.resolve()
    const refusal: unknown = await recover().catch((error: unknown) => error)
    expect(refusal).toHaveProperty('message', expect.stringContaining('OpenWaggle is quitting'))
    expect(refusal).not.toBeInstanceOf(DesktopNativeRecoveryUnavailableError)
    stopping.resolve()
    await quitting
  })

  it('stops offering recovery once quit has shut desktop tools down, even if quit fails later', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    mocks.closeTerminals.mockRejectedValueOnce(new Error('native process remains alive'))
    await expect(cleanup()).rejects.toThrow('native process remains alive')
    await expect(offeredRecovery()()).rejects.toBeInstanceOf(DesktopNativeRecoveryUnavailableError)
    expect(mocks.startBridge).toHaveBeenCalledOnce()
  })

  it('reports a partial recovery that lands during quit as quitting, not reconnecting', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    const started = Promise.withResolvers<unknown>()
    mocks.startBridge.mockReturnValueOnce(started.promise)
    const recovering = offeredRecovery()()
    const quitting = cleanup()
    started.reject(
      new DesktopServiceAttachmentError(
        { stop: mocks.stop, markClosed: mocks.markClosed, attachment: mocks.attachment },
        new Error('ready failed'),
      ),
    )
    await expect(recovering).rejects.toThrow('OpenWaggle is quitting')
    await quitting
    expect(mocks.events[0]).toBe('stop')
  })

  it('stops offering recovery once the kept lifecycle can never reattach', async () => {
    mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
    await startAppGuiDesktopServices(input())
    const recover = offeredRecovery()
    mocks.attachment.mockReturnValue('stopped')
    mocks.startBridge.mockRejectedValueOnce(
      new DesktopServiceAttachmentError(
        { stop: mocks.stop, markClosed: mocks.markClosed, attachment: mocks.attachment },
        new Error('ready failed'),
      ),
    )
    await expect(recover()).rejects.toThrow('still reconnecting')
    await expect(recover()).rejects.toBeInstanceOf(DesktopNativeRecoveryUnavailableError)
  })

  it('bounds how long quit waits for a recovery that never settles', async () => {
    vi.useFakeTimers()
    try {
      mocks.startBridge.mockRejectedValueOnce(new DesktopNativeQuarantinedError())
      const cleanup = await startAppGuiDesktopServices(input())
      mocks.startBridge.mockReturnValueOnce(new Promise(() => {}))
      void offeredRecovery()()
      const quitting = cleanup().catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(DESKTOP_SHUTDOWN_DRAIN_MS)
      expect(await quitting).toHaveProperty(
        'message',
        expect.stringContaining('recovery was still in progress'),
      )
      expect(mocks.events).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

function offeredRecovery() {
  const options = mocks.quarantine.mock.calls[0]?.[0]
  if (typeof options !== 'object' || options === null || !('recover' in options))
    throw new Error('Missing recovery')
  const { recover } = options
  if (typeof recover !== 'function') throw new Error('Missing recovery')
  return (): Promise<unknown> => recover()
}
