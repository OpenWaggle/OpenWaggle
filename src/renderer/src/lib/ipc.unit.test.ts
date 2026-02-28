import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the IPC wrapper module (`@/lib/ipc`).
 *
 * The module exports a single `api` object that is either the real `window.api`
 * (set by the Electron preload script) or a safe Proxy that logs errors and
 * returns rejected promises for invoke-style methods and no-op unsubscribers
 * for event-style (`on*`) methods.
 *
 * Since `window.api` is read at module evaluation time, we use dynamic imports
 * and `vi.resetModules()` to test both paths.
 */

describe('ipc', () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear any previous window.api assignment
    delete (globalThis as Record<string, unknown>).window
  })

  describe('when window.api is available', () => {
    it('exports the real api object', async () => {
      const fakeApi = {
        getSettings: vi.fn().mockResolvedValue({ providers: {} }),
        onStreamChunk: vi.fn(() => () => {}),
      }
      ;(globalThis as Record<string, unknown>).window = { api: fakeApi }

      const { api } = await import('./ipc')
      expect(api).toBe(fakeApi)
    })
  })

  describe('when window.api is unavailable (proxy fallback)', () => {
    beforeEach(() => {
      ;(globalThis as Record<string, unknown>).window = {}
    })

    it('returns a proxy object without throwing on access', async () => {
      const { api } = await import('./ipc')
      expect(api).toBeDefined()
    })

    it('returns a rejected promise for invoke-style methods', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('./ipc')

      // Access an arbitrary method — the proxy intercepts all property access
      const getSettings = api.getSettings
      await expect(getSettings()).rejects.toThrow(/window\.api unavailable/)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('getSettings'))

      consoleSpy.mockRestore()
    })

    it('returns a no-op unsubscribe function for on* event methods', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('./ipc')

      const unsubscribe = api.onStreamChunk(() => {})
      expect(typeof unsubscribe).toBe('function')
      // Calling unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow()

      consoleSpy.mockRestore()
    })

    it('logs an error message including the method name', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('./ipc')

      // Trigger the proxy for a named method
      api.onFullscreenChanged(() => {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('onFullscreenChanged'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('window.api unavailable'))

      consoleSpy.mockRestore()
    })
  })
})
