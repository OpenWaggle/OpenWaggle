import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider'
import { describe, expect, it, vi } from 'vitest'
import { registerPiBundledBedrockProvider } from '../pi-bundled-bedrock'

// Only the setter is mocked, so we can count invocations. `bedrock-provider` is
// intentionally left REAL: the test then fails if pi-ai changes the shape of
// bedrockProviderModule, which the previous fully-mocked test could not detect.
const piBedrockMocks = vi.hoisted(() => ({
  setBedrockProviderModule: vi.fn(),
}))

vi.mock('@earendil-works/pi-ai/api/bedrock-converse-stream.lazy', () => ({
  setBedrockProviderModule: piBedrockMocks.setBedrockProviderModule,
}))

describe('Pi bundled Bedrock registration', () => {
  it('registers the real static Bedrock module through the setter exactly once', () => {
    registerPiBundledBedrockProvider()
    registerPiBundledBedrockProvider()

    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledTimes(1)
    expect(piBedrockMocks.setBedrockProviderModule).toHaveBeenCalledWith(bedrockProviderModule)
  })

  it('registers a module satisfying the ProviderStreams shape the lazy loader expects', () => {
    // Real (unmocked) export — guards against pi-ai drift in the module that
    // backs the override, the semantic contract the fix depends on.
    expect(typeof bedrockProviderModule.stream).toBe('function')
    expect(typeof bedrockProviderModule.streamSimple).toBe('function')
  })
})
