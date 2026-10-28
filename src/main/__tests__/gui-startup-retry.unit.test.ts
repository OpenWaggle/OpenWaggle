/**
 * Retry while an attempt is still running (R1 P2-1): the real coordinator drives the real
 * `startGuiBackend`, whose Host lifecycle is a fake with the real one's single attachment slot.
 * Both attempts share that slot, the renderer bridge and the desktop services, so an aborted
 * attempt that unwinds late must not detach, or attach beside, the attempt that replaced it.
 */
import type { GuiStartupStatus } from '@shared/types/gui-startup'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Deferred<T> = PromiseWithResolvers<T>

interface HarnessState {
  route: 'local' | 'remote'
  liveBridges: number
  settingsRequests: Deferred<unknown>[]
  preparation: Deferred<void> | null
  desktopServices: Deferred<void> | null
}

const state = vi.hoisted(
  (): HarnessState => ({
    route: 'local',
    liveBridges: 0,
    settingsRequests: [],
    preparation: null,
    desktopServices: null,
  }),
)

const prepareGuiSessionHostLifecycle = vi.hoisted(() => vi.fn())
const startAppGuiDesktopServices = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/openwaggle-test-profile', getVersion: () => '1.0.0' },
}))
vi.mock('../desktop-ui', () => ({ getAllBrowserWindows: () => [], isAutomationMode: () => false }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../error-reporting', () => ({ startErrorReporting: vi.fn(async () => undefined) }))
vi.mock('../gui-auto-updater', () => ({ startGuiAutoUpdater: vi.fn(async () => undefined) }))
vi.mock('../gui-backend-gate', () => ({ releaseGuiBackendGate: vi.fn() }))
vi.mock('../installer-update-channel-intent', () => ({
  applyInstallerUpdateChannelIntent: vi.fn(async () => undefined),
}))
vi.mock('../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: vi.fn(async (channel: string) => {
    if (channel !== 'settings:get') return { handled: true, result: null }
    const request = Promise.withResolvers<unknown>()
    state.settingsRequests.push(request)
    return { handled: true, result: await request.promise }
  }),
}))
vi.mock('../session-host/gui-session-host-lifecycle', () => ({ prepareGuiSessionHostLifecycle }))
vi.mock('../gui-desktop-services', () => ({ startAppGuiDesktopServices }))
vi.mock('../usage-statistics/usage-statistics-gui', () => ({ startGuiUsageStatistics: vi.fn() }))
vi.mock('../store/settings', () => ({ hydrateSettingsStoreFromHost: vi.fn() }))

const { clearGuiBackend, startGuiBackend } = await import('../gui-backend-startup')
const { createGuiStartupCoordinator } = await import('../gui-startup-coordinator')

/** The real lifecycle's attachment slot: a start attaches a bridge, a stop detaches the current one. */
function fakeLifecycle() {
  let stopBridge: (() => void) | null = null
  return {
    client: { paths: {}, clientVersion: '1.0.0' },
    start: async () => {
      state.liveBridges += 1
      let stopped = false
      stopBridge = () => {
        if (stopped) return
        stopped = true
        state.liveBridges -= 1
      }
      state.route = 'remote'
    },
    stop: async () => {
      stopBridge?.()
      stopBridge = null
      state.route = 'local'
    },
  }
}

const runtimeModule = {
  initializeGuiRuntime: async () => undefined,
  runGuiEffect: vi.fn(),
  disposeGuiRuntime: vi.fn(),
}

function harness() {
  const published: GuiStartupStatus[] = []
  const timers: { callback: () => void; cancelled: boolean }[] = []
  const coordinator = createGuiStartupCoordinator({
    start: (progress, signal) =>
      startGuiBackend({
        progress,
        signal,
        onHostUnderway: () => undefined,
        hostHeadStart: Promise.resolve(),
        startupMark: () => undefined,
        // Only what startGuiBackend calls.
        loadRuntime: async () => fromPartial(runtimeModule),
      }),
    publish: (status) => published.push(status),
    onFailure: () => undefined,
    describeFailure: (error) => (error instanceof Error ? error.message : String(error)),
    restart: () => undefined,
    setTimer: (callback) => {
      const timer = { callback, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const fireDeadline = () => {
    for (const timer of timers) if (!timer.cancelled) timer.callback()
  }
  return { coordinator, published, fireDeadline }
}

const settle = async () => {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function takeSettingsRequest(which: 'latest' | 'earliest'): Deferred<unknown> | undefined {
  return which === 'latest' ? state.settingsRequests.pop() : state.settingsRequests.shift()
}

async function answerEverySettingsRequest() {
  while (state.settingsRequests.length > 0) {
    takeSettingsRequest('earliest')?.resolve({})
    await settle()
  }
}

beforeEach(() => {
  clearGuiBackend()
  state.route = 'local'
  state.liveBridges = 0
  state.settingsRequests = []
  state.preparation = null
  state.desktopServices = null
  prepareGuiSessionHostLifecycle.mockReset().mockImplementation(async () => {
    await state.preparation?.promise
    return fakeLifecycle()
  })
  startAppGuiDesktopServices.mockReset().mockImplementation(async () => {
    await state.desktopServices?.promise
    return async () => undefined
  })
})

describe('Retry while a late startup attempt is still running', () => {
  it('keeps the window attached when the aborted attempt unwinds after its replacement', async () => {
    const h = harness()
    h.coordinator.run()
    await settle()
    expect(state.settingsRequests).toHaveLength(1)
    h.fireDeadline()
    expect(h.coordinator.status().state).toBe('failed')

    h.coordinator.retry()
    await settle()
    // The replacement's Settings answer first, then the aborted attempt's.
    takeSettingsRequest('latest')?.resolve({})
    await settle()
    await answerEverySettingsRequest()

    expect(h.coordinator.status()).toEqual({ state: 'ready' })
    expect(state.route).toBe('remote')
    expect(state.liveBridges).toBe(1)
    expect(startAppGuiDesktopServices).toHaveBeenCalledOnce()
  })

  it('adopts an aborted attempt that was already starting desktop services', async () => {
    state.desktopServices = Promise.withResolvers<void>()
    const h = harness()
    h.coordinator.run()
    await settle()
    await answerEverySettingsRequest()
    expect(startAppGuiDesktopServices).toHaveBeenCalledOnce()
    h.fireDeadline()

    h.coordinator.retry()
    await settle()
    state.desktopServices.resolve()
    await settle()
    await answerEverySettingsRequest()

    expect(h.coordinator.status()).toEqual({ state: 'ready' })
    expect(state.route).toBe('remote')
    expect(state.liveBridges).toBe(1)
    expect(startAppGuiDesktopServices).toHaveBeenCalledOnce()
  })

  it('prepares the Host lifecycle, and its legacy cutover, once', async () => {
    state.preparation = Promise.withResolvers<void>()
    const h = harness()
    h.coordinator.run()
    await settle()
    h.fireDeadline()

    h.coordinator.retry()
    await settle()
    state.preparation.resolve()
    await settle()
    await answerEverySettingsRequest()

    expect(prepareGuiSessionHostLifecycle).toHaveBeenCalledOnce()
    expect(h.coordinator.status()).toEqual({ state: 'ready' })
    expect(state.liveBridges).toBe(1)
  })
})
