import { beforeEach, describe, expect, it, vi } from 'vitest'

const piBedrockMocks = vi.hoisted(() => ({
  setBedrockProviderModule: vi.fn(),
  bedrockProviderModule: { stream: vi.fn(), streamSimple: vi.fn() },
}))

vi.mock('@earendil-works/pi-ai/api/bedrock-converse-stream.lazy', () => ({
  setBedrockProviderModule: piBedrockMocks.setBedrockProviderModule,
}))
vi.mock('@earendil-works/pi-ai/bedrock-provider', () => ({
  bedrockProviderModule: piBedrockMocks.bedrockProviderModule,
}))

describe('Pi bundled Bedrock registration', () => {
  beforeEach(() => {
    vi.resetModules()
    piBedrockMocks.setBedrockProviderModule.mockReset()
  })

  it('registers the static Bedrock implementation once before bundled runtime use', async () => {
    const { registerPiBundledBedrockProvider } = await import('../pi-bundled-bedrock')

    registerPiBundledBedrockProvider()
    registerPiBundledBedrockProvider()

    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledTimes(1)
    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledWith(
      piBedrockMocks.bedrockProviderModule,
    )
  })
})
