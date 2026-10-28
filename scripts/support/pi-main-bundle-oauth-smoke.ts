/**
 * Resolves every OAuth provider's flow inside the main bundle, as the desktop window does: through
 * OpenWaggle's ModelRuntime chokepoint, without the Session Host runtime. Pi loads each flow
 * through a bundler-opaque import next to the bundle (`out/main/openai-codex.js`, never emitted)
 * unless its bundled loaders are registered first; the GUI composition root (A-F5) once lost that
 * registration and every OAuth refresh failed with "Cannot find module".
 */
import { createPiModelRuntime } from '../../src/main/adapters/pi/pi-model-runtime'

const UNRESOLVED_MODULE = /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load|Unknown file extension/u
const SMOKE_CREDENTIAL = {
  type: 'oauth' as const,
  access: 'smoke-access-token',
  refresh: 'smoke-refresh-token',
  expires: Date.now() + 3_600_000,
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Every flow loads; a malformed smoke credential may still be refused, which is not a load failure. */
export async function checkBundledOAuthLoaders() {
  const modelRuntime = await createPiModelRuntime()
  const providers = modelRuntime.getProviders().filter((provider) => provider.auth.oauth)
  if (!providers.some((provider) => provider.id === 'openai-codex')) {
    throw new Error('Pi main bundle smoke: Pi lists no openai-codex OAuth provider.')
  }
  for (const provider of providers) {
    try {
      await provider.auth.oauth?.toAuth(SMOKE_CREDENTIAL)
    } catch (error) {
      if (UNRESOLVED_MODULE.test(errorMessage(error))) {
        throw new Error(
          `Pi main bundle smoke: the ${provider.id} OAuth flow did not load: ${errorMessage(error)}`,
          { cause: error },
        )
      }
    }
  }
  return providers.map((provider) => provider.id).join(', ')
}
