import { createLogger } from '../logger'
import type { ProviderDefinition } from './provider-definition'

const logger = createLogger('providers')

class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>()
  private modelIndex = new Map<string, ProviderDefinition>()

  register(provider: ProviderDefinition): void {
    if (this.providers.has(provider.id)) {
      logger.warn(`Provider "${provider.id}" is already registered — skipping duplicate`)
      return
    }
    this.providers.set(provider.id, provider)
    for (const modelId of provider.models) {
      this.modelIndex.set(modelId, provider)
    }
  }

  get(id: string): ProviderDefinition | undefined {
    return this.providers.get(id)
  }

  getAll(): ProviderDefinition[] {
    return [...this.providers.values()]
  }

  getProviderForModel(modelId: string): ProviderDefinition | undefined {
    return this.modelIndex.get(modelId)
  }

  isKnownModel(modelId: string): boolean {
    return this.modelIndex.has(modelId)
  }
}

export const providerRegistry = new ProviderRegistry()
