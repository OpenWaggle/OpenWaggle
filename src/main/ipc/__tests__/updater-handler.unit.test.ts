import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Shared mock handles ---
const mockCheckForUpdates = vi.fn()
const mockInstallUpdate = vi.fn()
const mockGetUpdateStatus = vi.fn()
const mockAppGetVersion = vi.fn((_arg?: string) => '0.1.0')
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
  checkForUpdates: () => mockCheckForUpdates(),
  installUpdate: () => mockInstallUpdate(),
  getUpdateStatus: () => mockGetUpdateStatus(),
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
    mockGetUpdateStatus.mockReset()
    mockAppGetVersion.mockReset()
    mockAppGetVersion.mockReturnValue('0.1.0')
    mockGetUpdateStatus.mockReturnValue({ type: 'idle' })
  })

  it('registers exactly four handlers', () => {
    registerUpdaterHandlers()

    expect(handlers.size).toBe(4)
    expect(handlers.has('updater:check')).toBe(true)
    expect(handlers.has('updater:install')).toBe(true)
    expect(handlers.has('updater:get-status')).toBe(true)
    expect(handlers.has('app:get-version')).toBe(true)
  })

  describe('updater:check', () => {
    it('calls checkForUpdates when invoked', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:check')
      expect(handler).toBeDefined()
      await handler?.({})
      expect(mockCheckForUpdates).toHaveBeenCalledOnce()
    })
  })

  describe('updater:install', () => {
    it('calls installUpdate when invoked', async () => {
      registerUpdaterHandlers()

      const handler = handlers.get('updater:install')
      expect(handler).toBeDefined()
      await handler?.({})
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
