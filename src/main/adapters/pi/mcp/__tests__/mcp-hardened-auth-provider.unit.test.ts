import type { AuthProvider } from '@earendil-works/pi-mcp'
import { describe, expect, it, vi } from 'vitest'
import { withHardenedTokenRefresh } from '../mcp-hardened-auth-provider'

describe('withHardenedTokenRefresh', () => {
  it('sends the stored token instead of letting Pi refresh it with the global fetch', async () => {
    const pi: AuthProvider & { settled: () => Promise<void> } = {
      token: vi.fn(async () => 'refreshed-with-global-fetch'),
      onUnauthorized: vi.fn(async () => undefined),
      settled: vi.fn(async () => undefined),
    }
    const provider = withHardenedTokenRefresh(pi, async () => 'expired-but-stored')

    await expect(provider.token()).resolves.toBe('expired-but-stored')
    expect(pi.token).not.toHaveBeenCalled()
    expect(pi.settled).toHaveBeenCalled()
  })

  it("refreshes after the server's 401 with the transport's hardened fetch", async () => {
    const onUnauthorized = vi.fn(async () => undefined)
    const provider = withHardenedTokenRefresh(
      { token: async () => undefined, onUnauthorized },
      async () => 'stale',
    )
    const hardenedFetch = vi.fn()
    const context = {
      response: new Response(null, { status: 401 }),
      serverUrl: new URL('https://mcp.example.com/mcp'),
      fetch: hardenedFetch,
      token: 'stale',
    }

    await provider.onUnauthorized?.(context)

    expect(onUnauthorized).toHaveBeenCalledWith(context)
  })
})
