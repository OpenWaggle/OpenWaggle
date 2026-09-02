import { describe, expect, it, vi } from 'vitest'

const navigationMocks = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.reject(new Error('blocked'))),
  warn: vi.fn(),
}))

vi.mock('../desktop-ui', () => ({ openExternal: navigationMocks.openExternal }))
vi.mock('../logger', () => ({
  createLogger: () => ({ warn: navigationMocks.warn }),
}))

import { externalNavigationProtocol, openExternalFromRenderer } from '../external-navigation'

describe('external renderer navigation logging', () => {
  it('logs only the protocol when a destination is blocked', async () => {
    const sensitiveUrl = 'https://example.com/callback?token=secret'

    openExternalFromRenderer(sensitiveUrl)

    await vi.waitFor(() => expect(navigationMocks.warn).toHaveBeenCalledOnce())
    expect(navigationMocks.warn).toHaveBeenCalledWith(
      'External navigation was not opened',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'blocked' }),
        protocol: 'https:',
      }),
    )
    expect(JSON.stringify(navigationMocks.warn.mock.calls)).not.toContain('token=secret')
  })

  it('labels malformed destinations without echoing them', () => {
    expect(externalNavigationProtocol('not a URL')).toBe('invalid')
  })
})
