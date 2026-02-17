import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { grokProvider } from './grok'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'
import { openrouterProvider } from './openrouter'
import { providerRegistry } from './registry'

export function registerAllProviders(): void {
  providerRegistry.register(anthropicProvider)
  providerRegistry.register(openaiProvider)
  providerRegistry.register(geminiProvider)
  providerRegistry.register(grokProvider)
  providerRegistry.register(openrouterProvider)
  providerRegistry.register(ollamaProvider)
}

export { providerRegistry }
