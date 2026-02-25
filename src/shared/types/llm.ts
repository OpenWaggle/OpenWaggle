import type { Provider } from './settings'

// SupportedModelId widens to string — runtime validation via provider registry.
// Kept as type alias for backward compatibility across the codebase.
export type SupportedModelId = string

// Display info for UI — generated dynamically from the provider registry
export interface ModelDisplayInfo {
  readonly id: string
  readonly name: string
  readonly provider: Provider
}

/** Provider metadata exposed to the renderer via IPC */
export interface ProviderInfo {
  readonly provider: Provider
  readonly displayName: string
  readonly requiresApiKey: boolean
  readonly apiKeyManagementUrl?: string
  readonly supportsBaseUrl: boolean
  readonly supportsSubscription: boolean
  readonly models: ModelDisplayInfo[]
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
