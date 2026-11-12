import type { SchemaType } from '@shared/schema'
import type {
  modelDisplayInfoSchema,
  providerApiKeyAuthSourceSchema,
  providerAuthInfoSchema,
  providerAuthSourceSchema,
  providerInfoSchema,
} from '@shared/schemas/llm'
import { SupportedModelId } from './brand'

// Re-export branded SupportedModelId from the canonical brand module.
export type { SupportedModelId } from './brand'

export type ProviderAuthSource = SchemaType<typeof providerAuthSourceSchema>
export type ProviderApiKeyAuthSource = SchemaType<typeof providerApiKeyAuthSourceSchema>
export type ProviderAuthInfo = SchemaType<typeof providerAuthInfoSchema>
export type ModelDisplayInfo = SchemaType<typeof modelDisplayInfoSchema>

/**
 * How much of Pi's model catalog `providers:get-models` returns. `available` keeps every
 * provider's metadata and auth state but only the models that can run now; the renderer loads it
 * at startup, where the composer only offers available models. `all` adds every model of every
 * provider, for Settings (renderer-load B14).
 */
export const PROVIDER_CATALOG_SCOPES = ['available', 'all'] as const
export type ProviderCatalogScope = (typeof PROVIDER_CATALOG_SCOPES)[number]

/** Provider metadata exposed to the renderer via IPC. */
export type ProviderInfo = SchemaType<typeof providerInfoSchema>

export function createModelRef(provider: string, modelId: string): SupportedModelId {
  return SupportedModelId(`${provider}/${modelId}`)
}

export function parseModelRef(
  modelRef: string,
): { readonly provider: string; readonly modelId: string } | null {
  const separatorIndex = modelRef.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelRef.length - 1) {
    return null
  }

  return {
    provider: modelRef.slice(0, separatorIndex),
    modelId: modelRef.slice(separatorIndex + 1),
  }
}

/** Human-readable name generation from model IDs */
export function generateDisplayName(modelId: string): string {
  // Brand capitalization rules
  const brandMap: Record<string, string> = {
    claude: 'Claude',
    gpt: 'GPT',
    gemini: 'Gemini',
    grok: 'Grok',
    ollama: 'Ollama',
    deepseek: 'DeepSeek',
    llama: 'Llama',
    mistral: 'Mistral',
    qwen: 'Qwen',
    phi: 'Phi',
  }

  // Strip provider prefix for openrouter (e.g. "anthropic/claude-opus-4" → "claude-opus-4")
  const segments = modelId.split('/')
  const bare = segments.length > 1 ? (segments[segments.length - 1] ?? modelId) : modelId

  // Split on hyphens, apply brand rules, capitalize the rest
  const tokens = bare.split('-')
  const mapped = tokens.map((token, i) => {
    const lower = token.toLowerCase()
    if (i === 0 && brandMap[lower]) return brandMap[lower]
    // Keep version numbers as-is (e.g. "4.1", "4-5" stays)
    if (/^\d/.test(token)) return token
    // Capitalize first letter
    return token.charAt(0).toUpperCase() + token.slice(1)
  })

  // Join with spaces, then collapse version-like patterns: "4 5" → "4.5"
  return mapped.join(' ').replace(/(\d) (\d)/g, '$1.$2')
}
