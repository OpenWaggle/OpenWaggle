import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockShellOpenPath = vi.fn()
const mockAppGetPath = vi.fn((_name: string) => '/tmp/logs')
const handlers = new Map<string, (...args: unknown[]) => unknown>()

const mockShellOpenExternal = vi.fn(async (_url: string) => {})

vi.mock('electron', () => ({
  shell: {
    openPath: (p: string) => mockShellOpenPath(p),
    openExternal: (url: string) => mockShellOpenExternal(url),
  },
  app: { getPath: (name: string) => mockAppGetPath(name) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerShellHandlers } from '../shell-handler'

describe('shell-handler', () => {
  beforeEach(() => {
    handlers.clear()
    mockShellOpenPath.mockReset()
    mockShellOpenExternal.mockReset()
    mockAppGetPath.mockReset()
    mockAppGetPath.mockReturnValue('/tmp/logs')
  })

  it('registers exactly three handlers', () => {
    registerShellHandlers()

    expect(handlers.size).toBe(3)
    expect(handlers.has('app:open-logs-dir')).toBe(true)
    expect(handlers.has('app:get-logs-path')).toBe(true)
    expect(handlers.has('shell:open-external')).toBe(true)
  })

  describe('app:open-logs-dir', () => {
    it('calls shell.openPath with the logs directory', () => {
      registerShellHandlers()

      const handler = handlers.get('app:open-logs-dir')
      expect(handler).toBeDefined()
      handler?.({})
      expect(mockShellOpenPath).toHaveBeenCalledWith('/tmp/logs')
      expect(mockAppGetPath).toHaveBeenCalledWith('logs')
    })

    it('uses the path returned by app.getPath', () => {
      mockAppGetPath.mockReturnValue('/custom/log/dir')
      registerShellHandlers()

      const handler = handlers.get('app:open-logs-dir')
      handler?.({})
      expect(mockShellOpenPath).toHaveBeenCalledWith('/custom/log/dir')
    })
  })

  describe('app:get-logs-path', () => {
    it('returns app.getPath("logs")', () => {
      registerShellHandlers()

      const handler = handlers.get('app:get-logs-path')
      expect(handler).toBeDefined()
      const result = handler?.()
      expect(mockAppGetPath).toHaveBeenCalledWith('logs')
      expect(result).toBe('/tmp/logs')
    })

    it('reflects the current logs path dynamically', () => {
      mockAppGetPath.mockReturnValue('/another/path')
      registerShellHandlers()

      const handler = handlers.get('app:get-logs-path')
      const result = handler?.()
      expect(result).toBe('/another/path')
    })
  })

  describe('shell:open-external', () => {
    it('opens https URLs via shell.openExternal', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')
      expect(handler).toBeDefined()

      await handler?.({}, 'https://github.com')
      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com')
    })

    it('opens http URLs via shell.openExternal', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await handler?.({}, 'http://localhost:3000')
      expect(mockShellOpenExternal).toHaveBeenCalledWith('http://localhost:3000')
    })

    it('rejects disallowed URL protocols', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await expect(handler?.({}, 'file:///etc/passwd')).rejects.toThrow(
        'Disallowed URL protocol: file:',
      )
      expect(mockShellOpenExternal).not.toHaveBeenCalled()
    })
  })
})
