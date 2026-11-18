import { beforeEach, describe, expect, it, vi } from 'vitest'

const piOAuthMocks = vi.hoisted(() => ({
  registerBunOAuthFlows: vi.fn(),
}))

vi.mock('@earendil-works/pi-ai/bun-oauth', () => piOAuthMocks)

describe('Pi bundled OAuth registration', () => {
  beforeEach(() => {
    vi.resetModules()
    piOAuthMocks.registerBunOAuthFlows.mockReset()
  })

  it('registers Pi OAuth loaders once before bundled runtime use', async () => {
    const { registerPiBundledOAuthFlows } = await import('../pi-bundled-oauth')

    registerPiBundledOAuthFlows()
    registerPiBundledOAuthFlows()

    expect(piOAuthMocks.registerBunOAuthFlows).toHaveBeenCalledTimes(1)
  })
})
