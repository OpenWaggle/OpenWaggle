import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerShellHandlers } from './shell-handler'

describe('shell-handler', () => {
  it('registers app:open-logs-dir and app:get-logs-path handlers', () => {
    registerShellHandlers()

    expect(handlers.has('app:open-logs-dir')).toBe(true)
    expect(handlers.has('app:get-logs-path')).toBe(true)
  })

  it('app:open-logs-dir calls shell.openPath with logs dir', () => {
    registerShellHandlers()

    const handler = handlers.get('app:open-logs-dir')
    expect(handler).toBeDefined()
    handler?.({})
    expect(mockShellOpenPath).toHaveBeenCalledWith('/tmp/logs')
    expect(mockAppGetPath).toHaveBeenCalledWith('logs')
  })

  it('app:get-logs-path returns app.getPath("logs")', () => {
    registerShellHandlers()

    const handler = handlers.get('app:get-logs-path')
    expect(handler).toBeDefined()
    const result = handler?.()
    expect(mockAppGetPath).toHaveBeenCalledWith('logs')
    expect(result).toBe('/tmp/logs')
  })
})
