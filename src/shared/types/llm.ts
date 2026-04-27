import { SupportedModelId } from './brand'
import type { Provider, ThinkingLevel } from './settings'

// Re-export branded SupportedModelId from the canonical brand module.
export type { SupportedModelId } from './brand'

export type ProviderAuthSource = 'none' | 'api-key' | 'oauth' | 'environment-or-custom'
export type ProviderApiKeyAuthSource = 'none' | 'api-key' | 'environment-or-custom'

export interface ProviderAuthInfo {
  /** Provider-level active auth source as Pi will resolve it for model availability. */
  readonly configured: boolean
  readonly source: ProviderAuthSource
  /** API-key section state only. OAuth credentials must not make this true. */
  readonly apiKeyConfigured: boolean
  readonly apiKeySource: ProviderApiKeyAuthSource
  /** OAuth section state only. API keys and environment credentials must not make this true. */
  readonly oauthConnected: boolean
  readonly supportsApiKey: boolean
  readonly supportsOAuth: boolean
  readonly apiKeyPreview?: string
}

// Display info for UI — generated dynamically from Pi model metadata.
export interface ModelDisplayInfo {
  /** Canonical Pi model reference: "provider/modelId". */
  readonly id: SupportedModelId
  /** Provider-local Pi model ID. This may itself contain slashes for hosted model routes. */
  readonly modelId: string
  readonly name: string
  readonly provider: Provider
  readonly available: boolean
  /** Thinking levels available for this concrete provider/model selection. */
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  /** Context window size in tokens (e.g., 200000, 1000000). Populated from provider metadata. */
  readonly contextWindow?: number
}

/** Provider metadata exposed to the renderer via IPC */
export interface ProviderInfo {
  readonly provider: Provider
  readonly displayName: string
  readonly apiKeyManagementUrl?: string
  readonly auth: ProviderAuthInfo
  readonly models: ModelDisplayInfo[]
}

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
