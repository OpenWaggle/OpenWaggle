import { describe, expect, it, vi } from 'vitest'
import { registerPiBundledBedrockProvider } from '../pi-bundled-bedrock'

// Only the setter is mocked, so we can count invocations. `bedrock-provider` stays real, so the
// type checker reports a change to the shape of bedrockProviderModule.
const piBedrockMocks = vi.hoisted(() => ({
  setBedrockProviderModule: vi.fn(),
}))

vi.mock('@earendil-works/pi-ai/api/bedrock-converse-stream.lazy', () => ({
  setBedrockProviderModule: piBedrockMocks.setBedrockProviderModule,
}))

describe('Pi bundled Bedrock registration', () => {
  it('registers the real static Bedrock streams through the setter exactly once', () => {
    registerPiBundledBedrockProvider()
    registerPiBundledBedrockProvider()

    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledTimes(1)
    // Each stream is wrapped so an expired-credential failure is retried once (#357).
    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledWith({
      stream: expect.any(Function),
      streamSimple: expect.any(Function),
    })
  })
})
