import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../auth', () => ({
  startOAuth: vi.fn(),
  disconnect: vi.fn(),
  getAccountInfo: vi.fn().mockReturnValue({
    provider: 'openrouter',
    connected: false,
    label: 'Not connected',
  }),
}))

describe('auth-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all auth IPC channels', async () => {
    const { registerAuthHandlers } = await import('./auth-handler')
    registerAuthHandlers()

    const registeredChannels = mockHandle.mock.calls.map((call: unknown[]) => call[0])
    expect(registeredChannels).toContain('auth:start-oauth')
    expect(registeredChannels).toContain('auth:disconnect')
    expect(registeredChannels).toContain('auth:get-account-info')
  })

  it('auth:get-account-info handler returns account info', async () => {
    const { registerAuthHandlers } = await import('./auth-handler')
    registerAuthHandlers()

    const getAccountInfoHandler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === 'auth:get-account-info',
    )?.[1] as (event: unknown, provider: string) => unknown

    expect(getAccountInfoHandler).toBeDefined()

    const result = await getAccountInfoHandler({}, 'openrouter')
    expect(result).toEqual({
      provider: 'openrouter',
      connected: false,
      label: 'Not connected',
    })
  })

  it('auth:get-account-info handler rejects invalid provider', async () => {
    const { registerAuthHandlers } = await import('./auth-handler')
    registerAuthHandlers()

    const getAccountInfoHandler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === 'auth:get-account-info',
    )?.[1] as (event: unknown, provider: string) => unknown

    await expect(getAccountInfoHandler({}, 'invalid-provider')).rejects.toThrow(
      'Invalid subscription provider',
    )
  })

  it('auth:disconnect handler calls disconnect', async () => {
    const { disconnect } = await import('../auth')
    const { registerAuthHandlers } = await import('./auth-handler')
    registerAuthHandlers()

    const disconnectHandler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === 'auth:disconnect',
    )?.[1] as (event: unknown, provider: string) => unknown

    disconnectHandler({}, 'openai')
    expect(disconnect).toHaveBeenCalledWith('openai')
  })
})
