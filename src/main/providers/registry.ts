import type { ProviderDefinition } from './provider-definition'

class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>()

  register(provider: ProviderDefinition): void {
    if (this.providers.has(provider.id)) {
      console.warn(`Provider "${provider.id}" is already registered — skipping duplicate`)
      return
    }
    this.providers.set(provider.id, provider)
  }

  get(id: string): ProviderDefinition | undefined {
    return this.providers.get(id)
  }

  getAll(): ProviderDefinition[] {
    return [...this.providers.values()]
  }

  getProviderForModel(modelId: string): ProviderDefinition | undefined {
    for (const provider of this.providers.values()) {
      if (provider.models.includes(modelId)) {
        return provider
      }
    }
    return undefined
  }

  isKnownModel(modelId: string): boolean {
    return this.getProviderForModel(modelId) !== undefined
  }
}

export const providerRegistry = new ProviderRegistry()
