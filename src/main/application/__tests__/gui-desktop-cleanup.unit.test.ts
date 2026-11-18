import { describe, expect, it, vi } from 'vitest'
import { makeGuiDesktopCleanup } from '../gui-desktop-cleanup'

function fixture() {
  const calls: string[] = []
  const services = {
    stopBridge: vi.fn(async () => {
      calls.push('bridge')
    }),
    beginBrowserShutdown: vi.fn(() => {
      calls.push('browser-admission')
    }),
    closeTerminals: vi.fn(async () => {
      calls.push('terminals')
    }),
    disposeRuntime: vi.fn(async () => {
      calls.push('runtime')
    }),
    closeBrowsers: vi.fn(async () => {
      calls.push('browsers')
    }),
    markClosed: vi.fn(async () => {
      calls.push('receipt')
    }),
  }
  return { calls, services, cleanup: makeGuiDesktopCleanup(services) }
}

describe('GUI native shutdown proof', () => {
  it('drains bridge and actual resources before recording clean closure', async () => {
    const { calls, cleanup } = fixture()
    await Promise.all([cleanup(), cleanup()])
    await cleanup()
    expect(calls).toEqual([
      'bridge',
      'browser-admission',
      'terminals',
      'runtime',
      'browsers',
      'receipt',
    ])
  })

  it('does not close native admission when bridge drain fails and permits a later retry', async () => {
    const { cleanup, services } = fixture()
    services.stopBridge.mockRejectedValueOnce(new Error('active mutation'))
    await expect(cleanup()).rejects.toThrow('active mutation')
    expect(services.beginBrowserShutdown).not.toHaveBeenCalled()
    expect(services.markClosed).not.toHaveBeenCalled()
    await cleanup()
    expect(services.markClosed).toHaveBeenCalledOnce()
  })

  it('retries a failed receipt without accessing an already disposed runtime', async () => {
    const { cleanup, services } = fixture()
    services.markClosed.mockRejectedValueOnce(new Error('disconnected'))
    await expect(cleanup()).rejects.toThrow('disconnected')
    await cleanup()
    expect(services.markClosed).toHaveBeenCalledTimes(2)
    expect(services.closeTerminals).toHaveBeenCalledOnce()
    expect(services.disposeRuntime).toHaveBeenCalledOnce()
  })

  it.each(['closeTerminals', 'disposeRuntime', 'closeBrowsers'] as const)(
    'never records proof after %s fails',
    async (stage) => {
      const { cleanup, services } = fixture()
      services[stage].mockRejectedValueOnce(new Error(stage))
      await expect(cleanup()).rejects.toThrow(stage)
      expect(services.markClosed).not.toHaveBeenCalled()
      await cleanup()
      expect(services.markClosed).toHaveBeenCalledOnce()
    },
  )
})
