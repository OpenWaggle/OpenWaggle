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
 *
 * After registration, subscription-only model IDs (e.g. Codex models that
 * are newer than the TanStack AI model meta) are indexed so that
 * `getProviderForModel()` resolves them immediately — before the user
 * triggers a manual `providers:fetch-models` IPC call.
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
  const settled = await Promise.allSettled(
    PROVIDERS.map(async (id) => {
      const { default: provider } = await loaders[id]()
      providerRegistry.register(provider)
    }),
  )
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn(`Failed to load provider "${PROVIDERS[i]}"`, {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  })

  // Index subscription-only models that aren't in the static TanStack model list.
  // These models (e.g. gpt-5.4, gpt-5.3-codex) are only available via Codex
  // subscription and are newer than the current @tanstack/ai-openai version.
  // Without this, getProviderForModel('gpt-5.4') returns undefined until the user
  // manually fetches models from the settings UI.
  await indexSubscriptionModels()
}

/**
 * Eagerly index subscription-only model IDs for each provider that supports
 * dynamic model fetch. Pulls the curated subscription model list without
 * making any network calls (providers with hardcoded lists resolve immediately).
 */
async function indexSubscriptionModels(): Promise<void> {
  const tasks: Promise<void>[] = []

  for (const provider of providerRegistry.getAll()) {
    if (!provider.supportsSubscription || !provider.fetchModels) {
      continue
    }
    tasks.push(
      provider
        .fetchModels(undefined, undefined, 'subscription')
        .then((models) => {
          if (models.length > 0) {
            providerRegistry.indexModels(models, provider)
          }
        })
        .catch((err) => {
          logger.warn(`Failed to index subscription models for "${provider.id}"`, {
            error: err instanceof Error ? err.message : String(err),
          })
        }),
    )
  }

  await Promise.all(tasks)
}

export { providerRegistry }
