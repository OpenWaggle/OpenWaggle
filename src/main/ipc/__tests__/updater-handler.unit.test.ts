import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Shared mock handles ---
const mockCheckForUpdates = vi.fn()
const mockInstallUpdate = vi.fn()
const mockGetUpdateStatus = vi.fn()
const mockAppGetVersion = vi.fn((_arg?: string) => '0.1.0')
const mockListActiveRuns = vi.fn((): unknown[] => [])
const mockShowMessageBox = vi.fn(() => Promise.resolve({ response: 2 }))
const mockInterruptSessionRun = vi.fn((_sessionId: string) => Effect.void)
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getVersion: () => mockAppGetVersion() },
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

vi.mock('../../updater', () => ({
  checkForUpdates: (channel?: unknown) => mockCheckForUpdates(channel),
  installUpdate: () => mockInstallUpdate(),
  getUpdateStatus: () => mockGetUpdateStatus(),
  setUpdateWaitingForRuns: vi.fn(),
}))

vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: () => Promise.resolve({ handled: true, result: mockListActiveRuns() }),
}))
vi.mock('../../application/host-ui-agent-operation', () => ({
  listHostUiActiveActivities: () => Effect.succeed([]),
}))
vi.mock('../../desktop-ui', () => ({
  getAllBrowserWindows: () => [],
  showMessageBox: () => mockShowMessageBox(),
}))
vi.mock('../../application/session-run-interruption', () => ({
  interruptSessionRun: (sessionId: string) => mockInterruptSessionRun(sessionId),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerUpdaterHandlers } from '../updater-handler'

describe('updater-handler', () => {
  beforeEach(() => {
    handlers.clear()
    mockCheckForUpdates.mockReset()
    mockInstallUpdate.mockReset()
    mockInstallUpdate.mockResolvedValue(undefined)
    mockGetUpdateStatus.mockReset()
    mockAppGetVersion.mockReset()
    mockAppGetVersion.mockReturnValue('0.1.0')
    mockGetUpdateStatus.mockReturnValue({ type: 'idle' })
  })

  it('registers exactly five handlers', () => {
    registerUpdaterHandlers()

    expect(handlers.size).toBe(5)
    expect(handlers.has('updater:check')).toBe(true)
    expect(handlers.has('updater:install')).toBe(true)
    expect(handlers.has('updater:install-now')).toBe(true)
    expect(handlers.has('updater:get-status')).toBe(true)
    expect(handlers.has('app:get-version')).toBe(true)
  })

  describe('updater:check', () => {
    it('calls checkForUpdates when invoked', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:check')
      expect(handler).toBeDefined()
      await handler?.({})
      expect(mockCheckForUpdates).toHaveBeenCalledWith(undefined)
    })

    it.each(['stable', 'beta', 'alpha'])('forwards the %s update channel', async (channel) => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:check')
      await handler?.({}, channel)
      expect(mockCheckForUpdates).toHaveBeenCalledWith(channel)
    })

    it.each(['https://attacker.example/update', 'latest', 'rc', null, { channel: 'stable' }])(
      'rejects invalid update channel %j before it reaches the updater',
      async (channel) => {
        registerUpdaterHandlers()

        const handler = handlers.get('updater:check')
        await expect(handler?.({}, channel)).rejects.toThrow('Invalid update channel')
        expect(mockCheckForUpdates).not.toHaveBeenCalled()
      },
    )
  })

  describe('updater:install', () => {
    beforeEach(() => {
      mockGetUpdateStatus.mockReturnValue({ type: 'downloaded', version: '1.0.0' })
      mockListActiveRuns.mockReset()
      mockListActiveRuns.mockReturnValue([])
      mockShowMessageBox.mockClear()
      mockInterruptSessionRun.mockClear()
    })

    it('installs without asking when no agent run is active', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:install')
      expect(handler).toBeDefined()
      await handler?.({})
      expect(mockShowMessageBox).not.toHaveBeenCalled()
      expect(mockInstallUpdate).toHaveBeenCalledOnce()
    })

    it('asks before restarting over active runs and installs nothing on Cancel', async () => {
      mockListActiveRuns.mockReturnValue([{ activity: 'agent-run', sessionId: 'session-1' }])
      registerUpdaterHandlers()

      await handlers.get('updater:install')?.({})

      expect(mockShowMessageBox).toHaveBeenCalledOnce()
      expect(mockInstallUpdate).not.toHaveBeenCalled()
    })

    it('stops active runs before installing on Restart now', async () => {
      mockListActiveRuns
        .mockReturnValueOnce([{ activity: 'agent-run', sessionId: 'session-1' }])
        .mockReturnValueOnce([{ activity: 'agent-run', sessionId: 'session-1' }])
        .mockReturnValueOnce([{ activity: 'agent-run', sessionId: 'session-1' }])
        .mockReturnValue([])
      mockShowMessageBox.mockResolvedValueOnce({ response: 1 })
      registerUpdaterHandlers()

      await handlers.get('updater:install')?.({})

      expect(mockInterruptSessionRun).toHaveBeenCalledWith('session-1')
      expect(mockInstallUpdate).toHaveBeenCalledOnce()
    })
  })

  describe('updater:get-status', () => {
    it('returns the current update status', async () => {
      mockGetUpdateStatus.mockReturnValue({ type: 'checking' })
      registerUpdaterHandlers()

      const handler = handlers.get('updater:get-status')
      expect(handler).toBeDefined()
      const result = await handler?.({})
      expect(mockGetUpdateStatus).toHaveBeenCalledOnce()
      expect(result).toEqual({ type: 'checking' })
    })

    it('returns idle status by default', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:get-status')
      const result = await handler?.({})
      expect(result).toEqual({ type: 'idle' })
    })
  })

  describe('app:get-version', () => {
    it('returns the app version from electron', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('app:get-version')
      expect(handler).toBeDefined()
      const result = await handler?.({})
      expect(mockAppGetVersion).toHaveBeenCalledOnce()
      expect(result).toBe('0.1.0')
    })

    it('reflects the version returned by app.getVersion', async () => {
      mockAppGetVersion.mockReturnValue('1.5.2')
      registerUpdaterHandlers()

      const handler = handlers.get('app:get-version')
      const result = await handler?.({})
      expect(result).toBe('1.5.2')
    })
  })
})
