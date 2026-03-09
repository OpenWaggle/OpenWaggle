import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockShellOpenPath = vi.fn()
const mockAppGetPath = vi.fn((_name: string) => '/tmp/logs')
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  shell: { openPath: (p: string) => mockShellOpenPath(p) },
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
    mockAppGetPath.mockReset()
    mockAppGetPath.mockReturnValue('/tmp/logs')
  })

  it('registers exactly two handlers', () => {
    registerShellHandlers()

    expect(handlers.size).toBe(2)
    expect(handlers.has('app:open-logs-dir')).toBe(true)
    expect(handlers.has('app:get-logs-path')).toBe(true)
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
})
