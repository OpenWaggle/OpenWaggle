import { fromPartial } from '@total-typescript/shoehorn'
import { Context, Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startAppGuiDesktopServices } from '../gui-desktop-services'
import { BrowserPreviewAutomationService } from '../ports/browser-preview-automation-service'
import { TerminalService } from '../ports/terminal-service'
import {
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
    quarantine: vi.fn(),
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
vi.mock('../desktop-native-admission', () => ({
  quarantineDesktopNativeAdmission: () => mocks.quarantine(),
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
  mocks.startBridge.mockResolvedValue({ stop: mocks.stop, markClosed: mocks.markClosed })
})

describe('desktop startup ownership wiring', () => {
  it('returns ordered cleanup only after a successful attachment', async () => {
    const cleanup = await startAppGuiDesktopServices(input())
    expect(mocks.events).toEqual([])
    await cleanup()
    await cleanup()
    expect(mocks.events).toEqual([
      'stop',
      'admission-closed',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
    expect(mocks.quarantine).not.toHaveBeenCalled()
  })

  it('cleans the exact acquired lifecycle before surfacing an initial attachment failure', async () => {
    const error = new DesktopServiceAttachmentError(
      { stop: mocks.stop, markClosed: mocks.markClosed },
      new Error('initial ready failed'),
    )
    mocks.startBridge.mockRejectedValue(error)
    await expect(startAppGuiDesktopServices(input())).rejects.toBe(error)
    expect(mocks.events).toEqual([
      'stop',
      'admission-closed',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
    expect(mocks.quarantine).not.toHaveBeenCalled()
  })

  it('keeps a quarantined GUI available without forging another desktop cleanup receipt', async () => {
    mocks.startBridge.mockRejectedValue(new DesktopNativeQuarantinedError())
    const cleanup = await startAppGuiDesktopServices(input())
    expect(mocks.quarantine).toHaveBeenCalledOnce()
    expect(mocks.events).toEqual([])
    await cleanup()
    expect(mocks.events).toEqual(['admission-closed', 'terminals', 'runtime', 'browsers'])
    expect(mocks.markClosed).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('does not publish clean ownership when initial failure cleanup cannot close native resources', async () => {
    const error = new DesktopServiceAttachmentError(
      { stop: mocks.stop, markClosed: mocks.markClosed },
      new Error('initial ready failed'),
    )
    mocks.startBridge.mockRejectedValue(error)
    mocks.closeTerminals.mockRejectedValue(new Error('native process remains alive'))
    await expect(startAppGuiDesktopServices(input())).rejects.toThrow(
      'native process remains alive',
    )
    expect(mocks.markClosed).not.toHaveBeenCalled()
    expect(mocks.disposeRuntime).not.toHaveBeenCalled()
    expect(mocks.closeBrowsers).not.toHaveBeenCalled()
  })
})
