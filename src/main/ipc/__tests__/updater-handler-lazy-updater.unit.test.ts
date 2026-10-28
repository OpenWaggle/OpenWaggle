import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const updaterModuleLoaded = vi.fn()
const mockCheckForUpdates = vi.fn()

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))
vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))
// The real updater imports electron-updater; its factory runs when the module is first loaded.
vi.mock('../../updater', () => {
  updaterModuleLoaded()
  return { checkForUpdates: mockCheckForUpdates, installUpdate: vi.fn() }
})
vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: () => Promise.resolve({ handled: true, result: [] }),
}))
vi.mock('../../application/host-ui-agent-operation', () => ({
  listHostUiActiveActivities: () => Effect.succeed([]),
}))
vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))
vi.mock('../../application/session-run-interruption-command', () => ({
  interruptSessionRunThrough: () => Promise.resolve(),
}))
vi.mock('../../desktop-ui', () => ({
  getAllBrowserWindows: () => [],
  showMessageBox: () => Promise.resolve({ response: 2 }),
}))

describe('updater IPC handlers', () => {
  it('do not load the updater, and electron-updater with it, until a check needs it', async () => {
    const { registerUpdaterHandlers } = await import('../updater-handler')

    registerUpdaterHandlers()
    await handlers.get('updater:get-status')?.({})
    expect(updaterModuleLoaded).not.toHaveBeenCalled()

    await handlers.get('updater:check')?.({}, 'beta')
    expect(updaterModuleLoaded).toHaveBeenCalledTimes(1)
    expect(mockCheckForUpdates).toHaveBeenCalledWith('beta')
  })
})
