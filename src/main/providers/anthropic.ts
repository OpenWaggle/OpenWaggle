import type { QualityPreset } from '@shared/types/settings'
import { isRecord } from '@shared/utils/validation'
import type { AnyTextAdapter, StreamChunk, TextOptions } from '@tanstack/ai'
import { ANTHROPIC_MODELS, AnthropicTextAdapter, createAnthropicChat } from '@tanstack/ai-anthropic'
import { createLogger } from '../logger'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

const logger = createLogger('anthropic-provider')
const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'

/** Claude Code identity string required for OAuth model access beyond haiku. */
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
/** Tool name prefix required by Anthropic OAuth identity validation. */
const MCP_TOOL_PREFIX = 'mcp_'

/**
 * Models available via Anthropic Claude Pro/Max subscription (OAuth).
 * Sourced from OpenClaw model registry (anthropic claude-code / oauth profile entries).
 * The API accepts the same model IDs as the API key flow for these models.
 */
const ANTHROPIC_SUBSCRIPTION_MODELS = [
  'claude-opus-4-6', // 200k ctx, 128k max
  'claude-opus-4-5', // 200k ctx, 64k max
  'claude-sonnet-4-6', // 200k ctx, 64k max
  'claude-sonnet-4-5', // 200k ctx, 64k max
  'claude-haiku-4-5', // 200k ctx, 64k max
] as const

const LOW = 1024
const MEDIUM = 4096
const HIGH = 10240
const LOW_VALUE_2048 = 2048
const MEDIUM_VALUE_8192 = 8192
const HIGH_VALUE_16384 = 16384
/** Minimum output tokens reserved beyond the thinking budget. */
const MIN_OUTPUT_TOKENS = 1024

/** Thinking token budgets per quality preset (pre-4.6 models). */
const THINKING_BUDGET: Record<QualityPreset, number> = { low: LOW, medium: MEDIUM, high: HIGH }
const OPUS_THINKING_BUDGET: Record<QualityPreset, number> = {
  low: LOW_VALUE_2048,
  medium: MEDIUM_VALUE_8192,
  high: HIGH_VALUE_16384,
}

/** Max output tokens for adaptive thinking models (4.6+). */
const ADAPTIVE_MAX_TOKENS: Record<QualityPreset, number> = {
  low: 4096,
  medium: 16000,
  high: 32000,
}

/** Whether a model supports adaptive thinking (4.6+). */
function supportsAdaptiveThinking(modelId: string): boolean {
  return modelId.includes('4-6')
}

/**
 * Type guard for accessing TanStack AnthropicTextAdapter private methods.
 * These are marked private in TS declarations but exist at runtime on the prototype.
 * Pattern documented in learnings: "TanStack adapter private members are inaccessible
 * in TS subclasses but accessible at runtime. Use factory function pattern."
 */
interface AnthropicAdapterInternals {
  mapCommonOptionsToAnthropic(opts: unknown): unknown
  processAnthropicStream(
    stream: unknown,
    model: string,
    idGen: () => string,
  ): AsyncIterable<StreamChunk>
}

function hasAnthropicInternals(
  adapter: AnyTextAdapter,
): adapter is AnyTextAdapter & AnthropicAdapterInternals {
  return 'mapCommonOptionsToAnthropic' in adapter && 'processAnthropicStream' in adapter
}

/**
 * Parse raw SSE (Server-Sent Events) response body into typed event objects.
 *
 * The Anthropic streaming API returns SSE-formatted responses:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}
 *
 * processAnthropicStream expects an AsyncIterable of parsed event objects
 * (e.g. `{ type: "content_block_delta", delta: { ... } }`), not raw bytes.
 * This function bridges raw fetch → parsed events.
 */
async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        if (!part.trim()) continue

        // Extract data field(s) from the SSE event (per spec, multi-line data fields are joined with \n)
        let data = ''
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            data += (data ? '\n' : '') + line.slice(6)
          }
        }

        if (!data || data === '[DONE]') continue

        try {
          yield JSON.parse(data)
        } catch {
          logger.warn('Unparseable SSE event data', { data: data.slice(0, 200) })
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      let data = ''
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data: ')) {
          data += (data ? '\n' : '') + line.slice(6)
        }
      }
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data)
        } catch {
          logger.warn('Unparseable trailing SSE data', { data: data.slice(0, 200) })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Strip `mcp_` prefix from tool names in SSE events.
 * OAuth identity validation requires `mcp_`-prefixed tool names in requests,
 * but our internal tool system uses unprefixed names.
 */
async function* stripMcpToolPrefix(events: AsyncIterable<unknown>): AsyncIterable<unknown> {
  for await (const event of events) {
    if (
      isRecord(event) &&
      event.type === 'content_block_start' &&
      isRecord(event.content_block) &&
      event.content_block.type === 'tool_use' &&
      typeof event.content_block.name === 'string' &&
      event.content_block.name.startsWith(MCP_TOOL_PREFIX)
    ) {
      yield {
        ...event,
        content_block: {
          ...event.content_block,
          name: event.content_block.name.slice(MCP_TOOL_PREFIX.length),
        },
      }
    } else {
      yield event
    }
  }
}

/**
 * Extract the abort signal from TextOptions.request, which can be
 * Request | RequestInit | undefined.
 */
function extractSignalFromRequest(request: unknown): AbortSignal | undefined {
  if (!isRecord(request)) return undefined
  const { signal } = request
  if (signal instanceof AbortSignal) return signal
  return undefined
}

/**
 * Extract extra headers from TextOptions.request for forwarding.
 */
function extractHeadersFromRequest(request: unknown): Record<string, string> | undefined {
  if (!isRecord(request)) return undefined
  const { headers } = request
  if (!isRecord(headers)) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Create an adapter for setup-token / subscription OAuth auth.
 *
 * Setup tokens (`sk-ant-oat01-...`) and subscription OAuth tokens require:
 * - `Authorization: Bearer` auth (not `x-api-key`)
 * - GA endpoint (`/v1/messages`, not `/v1/messages?beta=true`)
 * - Claude Code identity headers (`user-agent`, `x-app`)
 * - Conditional beta headers (skip interleaved-thinking for 4.6 models)
 *
 * Sourced from OpenClaw pi-ai anthropic.js `createClient()` OAuth path.
 */
function createOAuthAdapter(token: string, model: string): AnyTextAdapter {
  // Build beta header for OAuth requests.
  // All 4 betas required for full model access (per OpenClaw/OpenCode):
  // - claude-code-20250219: Claude Code identity
  // - oauth-2025-04-20: OAuth auth flow
  // - interleaved-thinking-2025-05-14: thinking support (skip for 4.6, built-in)
  // - fine-grained-tool-streaming-2025-05-14: granular tool streaming events
  const betaFeatures: string[] = []
  if (!supportsAdaptiveThinking(model)) {
    betaFeatures.push('interleaved-thinking-2025-05-14')
  }
  const betaParts = [
    'claude-code-20250219',
    'oauth-2025-04-20',
    ...betaFeatures,
    'fine-grained-tool-streaming-2025-05-14',
  ]
  const betaHeader = betaParts.join(',')

  // Create base adapter with placeholder API key. chatStream is overridden with
  // raw fetch below, so the SDK client created by the constructor is never used
  // for actual API calls. We keep the adapter solely for processAnthropicStream
  // (SSE event → StreamChunk conversion).
  const adapter = new AnthropicTextAdapter({ apiKey: 'unused-oauth-raw-fetch' }, model)

  if (!hasAnthropicInternals(adapter)) {
    throw new Error(
      'AnthropicTextAdapter missing expected internal methods (mapCommonOptionsToAnthropic, processAnthropicStream)',
    )
  }

  // Bind internal methods before overriding chatStream so they retain
  // access to the adapter's own state (client, model metadata, etc.).
  const processStream = adapter.processAnthropicStream.bind(adapter)
  const mapOptions = adapter.mapCommonOptionsToAnthropic.bind(adapter)

  // Override chatStream to use raw fetch with Bearer auth + identity headers.
  // The SDK client's default path uses x-api-key auth and the beta endpoint
  // (client.beta.messages.create) — both incompatible with subscription OAuth.
  adapter.chatStream = async function* (options: TextOptions) {
    try {
      const requestParams = mapOptions(options)

      // Build clean request body — strip undefined values (temperature, top_p etc.)
      const body: Record<string, unknown> = { stream: true }
      if (isRecord(requestParams)) {
        for (const [key, value] of Object.entries(requestParams)) {
          if (value !== undefined) body[key] = value
        }
      }

      // Prepend Claude Code identity to system prompt (required for OAuth model access).
      // Filter out empty strings — Anthropic rejects empty text content blocks.
      if (typeof body.system === 'string') {
        const blocks = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }]
        if (body.system.length > 0) blocks.push({ type: 'text', text: body.system })
        body.system = blocks
      } else if (Array.isArray(body.system)) {
        body.system = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, ...body.system]
      } else {
        body.system = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }]
      }

      // Prefix tool names with mcp_ (required for OAuth identity validation).
      // Guard against double-prefixing for tools that already have the prefix (e.g. MCP-sourced tools).
      if (Array.isArray(body.tools)) {
        for (const tool of body.tools) {
          if (
            isRecord(tool) &&
            typeof tool.name === 'string' &&
            !tool.name.startsWith(MCP_TOOL_PREFIX)
          ) {
            tool.name = `${MCP_TOOL_PREFIX}${tool.name}`
          }
        }
      }
      if (Array.isArray(body.messages)) {
        for (const msg of body.messages) {
          if (isRecord(msg) && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (
                isRecord(block) &&
                block.type === 'tool_use' &&
                typeof block.name === 'string' &&
                !block.name.startsWith(MCP_TOOL_PREFIX)
              ) {
                block.name = `${MCP_TOOL_PREFIX}${block.name}`
              }
            }
          }
        }
      }
      // Also prefix tool_choice.name if forcing a specific tool
      if (
        isRecord(body.tool_choice) &&
        body.tool_choice.type === 'tool' &&
        typeof body.tool_choice.name === 'string' &&
        !body.tool_choice.name.startsWith(MCP_TOOL_PREFIX)
      ) {
        body.tool_choice = {
          ...body.tool_choice,
          name: `${MCP_TOOL_PREFIX}${body.tool_choice.name}`,
        }
      }

      const signal = extractSignalFromRequest(options.request)
      const extraHeaders = extractHeadersFromRequest(options.request)

      // Headers matching OpenClaw's OAuth request format.
      // extraHeaders are spread first so they cannot override security-critical values.
      const headers: Record<string, string> = {
        ...extraHeaders,
        'content-type': 'application/json',
        accept: 'application/json',
        'anthropic-version': ANTHROPIC_API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': betaHeader,
        'user-agent': 'claude-cli/2.1.75',
        'x-app': 'cli',
        authorization: `Bearer ${token}`,
      }

      const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`${response.status} ${errorBody}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      // Parse the raw SSE stream into typed event objects, then feed them
      // through the adapter's stream processor (SSE event → StreamChunk).
      const idGen = (): string =>
        `anthropic-${Date.now()}-${Math.random().toString(36).substring(7)}`
      yield* processStream(stripMcpToolPrefix(parseAnthropicSSE(response.body)), model, idGen)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred'
      const code =
        isRecord(error) && typeof error.code === 'string'
          ? error.code
          : isRecord(error) && typeof error.status === 'number'
            ? String(error.status)
            : 'UNKNOWN'

      yield {
        type: 'RUN_ERROR',
        model,
        timestamp: Date.now(),
        error: { message, code },
      } satisfies StreamChunk
    }
  }

  return adapter
}

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  displayName: 'Anthropic',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.claude.com/settings/keys',
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: true,
  models: ANTHROPIC_MODELS,
  testModel: 'claude-haiku-4-5',
  supportsAttachment: (kind) => kind === 'image' || kind === 'pdf',
  createAdapter(model, apiKey, _baseUrl, authMethod) {
    if (!apiKey) throw new Error('Anthropic API key is required')

    // Setup tokens (sk-ant-oat...) need Bearer auth + GA endpoint + identity headers.
    // Route them through the OAuth adapter regardless of authMethod label.
    if (apiKey.startsWith('sk-ant-oat')) {
      return createOAuthAdapter(apiKey, model)
    }

    // Subscription OAuth (from our OAuth flow)
    if (authMethod === 'subscription') {
      return createOAuthAdapter(apiKey, model)
    }

    // Standard API key — pure TanStack, no tweaks
    return createAnthropicChat(model, apiKey)
  },
  async fetchModels(_baseUrl, apiKey, authMethod) {
    // Claude Code subscription: use curated list (same API endpoint but filtered to Pro/Max models)
    if (authMethod === 'subscription') return [...ANTHROPIC_SUBSCRIPTION_MODELS]
    if (!apiKey) return [...ANTHROPIC_MODELS]
    try {
      const response = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
      })
      if (!response.ok) return [...ANTHROPIC_MODELS]
      const body: unknown = await response.json()
      if (!isRecord(body) || !Array.isArray(body.data)) return [...ANTHROPIC_MODELS]
      const models: string[] = []
      for (const entry of body.data) {
        if (isRecord(entry) && entry.type === 'model' && typeof entry.id === 'string') {
          models.push(entry.id)
        }
      }
      return models.length > 0 ? models : [...ANTHROPIC_MODELS]
    } catch (err) {
      logger.warn('Failed to fetch Anthropic models dynamically', {
        error: err instanceof Error ? err.message : 'unknown',
      })
      return [...ANTHROPIC_MODELS]
    }
  },
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    // 4.6 models use adaptive thinking (GA, no manual thinking).
    // Per Anthropic migration docs: thinking: {type: "adaptive"} + output_config: {effort: "..."}
    // are the correct params, but these require a newer SDK and API support.
    // For now, we send no thinking config — the adapter will use defaults.
    if (model.includes('4-6')) {
      return {
        temperature: undefined,
        topP: undefined,
        maxTokens: ADAPTIVE_MAX_TOKENS[preset],
        modelOptions: undefined,
      }
    }
    // Pre-4.6: manual thinking with budget_tokens
    const budget = model.includes('opus') ? OPUS_THINKING_BUDGET[preset] : THINKING_BUDGET[preset]
    return {
      temperature: undefined,
      topP: undefined,
      maxTokens: Math.max(base.maxTokens, budget + MIN_OUTPUT_TOKENS),
      modelOptions: { thinking: { type: 'enabled', budget_tokens: budget } },
    }
  },
}
