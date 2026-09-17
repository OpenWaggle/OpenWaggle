import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy'
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider'

let registered = false

/**
 * Pi loads the Amazon Bedrock Converse implementation through a deliberately
 * bundler-opaque dynamic import so browser/Bun bundlers cannot pull the
 * Node-only AWS SDK into their output. OpenWaggle bundles pi-ai into the
 * Electron main chunk, so that dynamic specifier resolves next to
 * out/main/index.js — where the chunk was never emitted — and every Bedrock
 * request fails with "Cannot find module .../bedrock-converse-stream.js".
 *
 * Register the statically-imported implementation before the first Bedrock
 * stream (the same escape hatch Pi uses for its standalone Bun binary), so the
 * lazy loader uses the override and skips the unresolvable import. The override
 * is read per stream call and never memoized, so registering any time before a
 * request is issued is sufficient. Called both at runtime module load and at
 * the ModelRuntime construction chokepoint; the guard makes repeats free.
 */
export function registerPiBundledBedrockProvider() {
  if (registered) {
    return
  }

  setBedrockProviderModule(bedrockProviderModule)
  registered = true
}
