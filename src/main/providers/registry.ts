import type { AnyTextAdapter } from '@tanstack/ai'
import type { ProviderDefinition } from './provider-definition'

class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>()

  register(provider: ProviderDefinition): void {
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
      if ((provider.models as readonly string[]).includes(modelId)) {
        return provider
      }
    }
    return undefined
  }

  createAdapter(modelId: string, apiKey: string, baseUrl?: string): AnyTextAdapter {
    const provider = this.getProviderForModel(modelId)
    if (!provider) throw new Error(`No provider registered for model: ${modelId}`)
    return provider.createAdapter(modelId, apiKey, baseUrl)
  }

  getAllModelIds(): string[] {
    const ids: string[] = []
    for (const provider of this.providers.values()) {
      ids.push(...provider.models)
    }
    return ids
  }

  isKnownModel(modelId: string): boolean {
    return this.getProviderForModel(modelId) !== undefined
  }
}

export const providerRegistry = new ProviderRegistry()
