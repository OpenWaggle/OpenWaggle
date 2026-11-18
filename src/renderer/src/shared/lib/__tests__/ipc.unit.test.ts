import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the IPC wrapper module (`@/shared/lib/ipc`).
 *
 * The module exports a single `api` object that is either the real `window.api`
 * (set by the Electron preload script) or a safe Proxy that logs errors and
 * returns rejected promises for invoke-style methods and no-op unsubscribers
 * for event-style (`on*`) methods.
 *
 * Since `window.api` is read at module evaluation time, we use dynamic imports
 * and `vi.resetModules()` to test both paths.
 */

function clearWindow() {
  Reflect.deleteProperty(globalThis, 'window')
}

/** A window as the packaged app loads it; the logger reads its location. */
function setWindow(value: object) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { protocol: 'file:' }, ...value },
    writable: true,
  })
}

describe('ipc', () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear any previous window.api assignment
    clearWindow()
  })

  describe('when window.api is available', () => {
    it('reports only real preload capabilities through the in operator', async () => {
      setWindow({ api: { getSettings: vi.fn() } })
      const { api } = await import('../ipc')
      expect('getSettings' in api).toBe(true)
      expect('listHiveSessionCatalogPage' in api).toBe(false)
      expect('onSessionHostEvent' in api).toBe(false)
    })

    it('delegates to the real api object', async () => {
      const fakeApi = {
        getSettings: vi.fn().mockResolvedValue({ providers: {} }),
        onAgentEvent: vi.fn(() => () => {}),
      }
      setWindow({ api: fakeApi })

      const { api } = await import('../ipc')
      await expect(api.getSettings()).resolves.toEqual({ providers: {} })
      expect(fakeApi.getSettings).toHaveBeenCalledTimes(1)
    })

    it('names the API method on a rejected call, and returns the same wrapper per method', async () => {
      const failure = new Error('connect ECONNREFUSED 127.0.0.1:443')
      const untagged = new Error('getaddrinfo ENOTFOUND api.example.com')
      const fakeApi = {
        getSettings: vi.fn().mockRejectedValue(failure),
        listSessionProjectPage: vi.fn().mockRejectedValue(untagged),
        onAgentEvent: vi.fn(() => () => {}),
      }
      setWindow({ api: fakeApi })

      const { api, rejectedApiMethodOf } = await import('../ipc')

      // The same error object rejects, now attributable; without the fix it stays untagged.
      await expect(api.getSettings()).rejects.toBe(failure)
      expect(rejectedApiMethodOf(failure)).toBe('getSettings')
      expect(rejectedApiMethodOf(untagged)).toBeUndefined()
      await expect(api.listSessionProjectPage(50)).rejects.toBe(untagged)
      expect(rejectedApiMethodOf(untagged)).toBe('listSessionProjectPage')
      expect(rejectedApiMethodOf('not an object')).toBeUndefined()

      // One wrapper per name, so property access keeps returning one stable function.
      expect(api.getSettings).toBe(api.getSettings)
      expect(api.getSettings).not.toBe(api.listSessionProjectPage)

      // A subscription's unsubscribe function is not a promise, so it passes through unwrapped.
      const unsubscribe = api.onAgentEvent(() => {})
      expect(() => unsubscribe()).not.toThrow()
    })

    it('does not rename an error a later call reports again', async () => {
      const failure = new Error('TypeError: fetch failed')
      const first = vi.fn().mockRejectedValue(failure)
      const second = vi.fn().mockRejectedValue(failure)
      setWindow({ api: { getSettings: first, listSessionProjectPage: second } })

      const { api, rejectedApiMethodOf } = await import('../ipc')
      await expect(api.getSettings()).rejects.toBe(failure)
      await expect(api.listSessionProjectPage(50)).rejects.toBe(failure)
      expect(rejectedApiMethodOf(failure)).toBe('getSettings')
    })

    it('uses fallback behavior for missing methods on a stale preload api', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setWindow({ api: { getSettings: vi.fn() } })

      const { api } = await import('../ipc')
      await expect(api.listSessionCatalogPage(false, 100)).rejects.toThrow(
        /window\.api unavailable/,
      )
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('listSessionCatalogPage'))

      consoleSpy.mockRestore()
    })
  })

  describe('when window.api is unavailable (proxy fallback)', () => {
    beforeEach(() => {
      setWindow({})
    })

    it('returns a proxy object without throwing on access', async () => {
      const { api } = await import('../ipc')
      expect(api).toBeDefined()
    })

    it('returns a rejected promise for invoke-style methods', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('../ipc')

      // Access an arbitrary method — the proxy intercepts all property access
      const getSettings = api.getSettings
      await expect(getSettings()).rejects.toThrow(/window\.api unavailable/)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('getSettings'))

      consoleSpy.mockRestore()
    })

    it('returns a no-op unsubscribe function for on* event methods', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('../ipc')

      const unsubscribe = api.onAgentEvent(() => {})
      expect(typeof unsubscribe).toBe('function')
      // Calling unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow()

      consoleSpy.mockRestore()
    })

    it('names the missing method on its rejected promise, for error reports', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api, rejectedApiMethodOf } = await import('../ipc')

      const failure = await api.getSettings().then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(rejectedApiMethodOf(failure)).toBe('getSettings')

      consoleSpy.mockRestore()
    })

    it('logs an error message including the method name', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { api } = await import('../ipc')

      // Trigger the proxy for a named method
      api.onFullscreenChanged(() => {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('onFullscreenChanged'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('window.api unavailable'))

      consoleSpy.mockRestore()
    })
  })
})
