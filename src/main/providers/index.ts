import type { Provider } from '@shared/types/settings'
import { PROVIDERS } from '@shared/types/settings'
import { createLogger } from '../logger'
import type { ProviderDefinition } from './provider-definition'
import { providerRegistry } from './registry'

const logger = createLogger('providers')

/**
 * Register all provider definitions.
 * Each import is wrapped in try/catch so a missing or broken provider
 * package doesn't prevent the entire app from starting.
 */
export async function registerAllProviders(): Promise<void> {
  const loaders: Record<Provider, () => Promise<{ default: ProviderDefinition }>> = {
    anthropic: () => import('./anthropic').then((m) => ({ default: m.anthropicProvider })),
    openai: () => import('./openai').then((m) => ({ default: m.openaiProvider })),
    gemini: () => import('./gemini').then((m) => ({ default: m.geminiProvider })),
    grok: () => import('./grok').then((m) => ({ default: m.grokProvider })),
    openrouter: () => import('./openrouter').then((m) => ({ default: m.openrouterProvider })),
    ollama: () => import('./ollama').then((m) => ({ default: m.ollamaProvider })),
  }

  // Exhaustiveness: if a new Provider is added to PROVIDERS but not to loaders,
  // TypeScript will error on the Record<Provider, ...> type above.
  for (const id of PROVIDERS) {
    try {
      const { default: provider } = await loaders[id]()
      providerRegistry.register(provider)
    } catch (err) {
      logger.warn(`Failed to load provider "${id}"`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export { providerRegistry }
