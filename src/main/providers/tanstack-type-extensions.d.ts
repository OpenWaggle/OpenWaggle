/**
 * Widen TanStack adapter model type constraints to accept any string model ID.
 * TanStack locks models to a static literal union; we support dynamic IDs from /v1/models.
 * This augmentation adds overloads so callers can pass `string` without casts.
 */
import type { AnyTextAdapter } from '@tanstack/ai'
import type { AnthropicTextConfig } from '@tanstack/ai-anthropic'
import type { OpenAITextConfig } from '@tanstack/ai-openai'

declare module '@tanstack/ai-anthropic' {
  export function createAnthropicChat(
    model: string,
    apiKey: string,
    config?: Omit<AnthropicTextConfig, 'apiKey'>,
  ): AnyTextAdapter

  // Re-declare constructor with string model — return type is AnyTextAdapter
  // so callers don't need to cast the instance.
  interface AnthropicTextAdapterConstructor {
    new (config: AnthropicTextConfig, model: string): AnyTextAdapter
  }
  const AnthropicTextAdapter: AnthropicTextAdapterConstructor
}

declare module '@tanstack/ai-openai' {
  export function createOpenaiChat(
    model: string,
    apiKey: string,
    config?: Omit<OpenAITextConfig, 'apiKey'>,
  ): AnyTextAdapter
}

declare module '@tanstack/ai-openrouter' {
  export function createOpenRouterText(model: string, apiKey: string): AnyTextAdapter
}
