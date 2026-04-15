import { TRIPLE_FACTOR } from '@shared/constants/math'
import type { QualityPreset } from '@shared/types/settings'
import { isRecord } from '@shared/utils/validation'
import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import type { ModelContextWindow } from '../domain/compaction/compaction-types'
import { codexSseTraceEnabled } from '../env'
import { createLogger } from '../logger'
import { isReasoningModel } from './model-classification'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

const DECODE_BASE64_URL_VALUE_4 = 4
const SLICE_ARG_2 = 512
const RESOLVE_SAMPLING_VALUE_4 = 4

const logger = createLogger('openai-provider')
const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

/**
 * Models available via OpenAI Codex (ChatGPT Plus/Pro) subscription.
 * Cannot be fetched dynamically — chatgpt.com requires a browser session.
 * Sourced from pi-ai openai-codex provider in models.generated.js.
 */
const OPENAI_CODEX_SUBSCRIPTION_MODELS = [
  'gpt-5.4', // 272k ctx, 128k max
  'gpt-5.3-codex', // 272k ctx, 128k max
  'gpt-5.3-codex-spark', // 128k ctx, 128k max
  'gpt-5.2', // 272k ctx, 128k max
  'gpt-5.2-codex', // 272k ctx, 128k max
  'gpt-5.1-codex-max', // 272k ctx, 128k max
  'gpt-5.1-codex-mini', // 272k ctx, 128k max
  'gpt-5.1', // 272k ctx, 128k max
] as const
const OPENAI_CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const OPENAI_CODEX_REASONING_INCLUDE = 'reasoning.encrypted_content'
// NOTE: originator and user-agent are set to 'openwaggle' for honest identification.
// If Codex backend rejects non-'pi' originators, revert to the OpenClaw values:
//   originator: 'pi'
//   user-agent: `pi (${process.platform} ...)`
const OPENAI_CODEX_USER_AGENT = `openwaggle (${process.platform} ${process.release?.name ?? 'node'}; ${process.arch})`

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof input === 'object' && 'method' in input && typeof input.method === 'string') {
    return input.method.toUpperCase()
  }
  return 'GET'
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    Math.ceil(normalized.length / DECODE_BASE64_URL_VALUE_4) * DECODE_BASE64_URL_VALUE_4,
    '=',
  )
  return Buffer.from(padded, 'base64').toString('utf8')
}

function extractChatgptAccountId(accessToken: string): string | null {
  const segments = accessToken.split('.')
  if (segments.length !== TRIPLE_FACTOR) {
    return null
  }
  try {
    const payloadSegment = segments[1]
    if (!payloadSegment) {
      return null
    }
    const parsedPayload: unknown = JSON.parse(decodeBase64Url(payloadSegment))
    if (!isRecord(parsedPayload)) {
      return null
    }
    const authClaims = parsedPayload[OPENAI_CODEX_JWT_CLAIM_PATH]
    if (!isRecord(authClaims)) {
      return null
    }
    const accountId = authClaims.chatgpt_account_id
    return typeof accountId === 'string' && accountId.trim() ? accountId : null
  } catch {
    return null
  }
}

function resolveCodexResponsesUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    if (normalizedPath.endsWith('/codex/responses')) {
      parsed.pathname = normalizedPath
      return parsed.toString()
    }
    if (normalizedPath.endsWith('/codex')) {
      parsed.pathname = `${normalizedPath}/responses`
      return parsed.toString()
    }
    if (normalizedPath.endsWith('/responses')) {
      parsed.pathname = normalizedPath.replace(/\/responses$/, '/codex/responses')
      return parsed.toString()
    }
    parsed.pathname = `${normalizedPath}/codex/responses`
    return parsed.toString()
  } catch {
    return url
  }
}

function isChatgptBackendPostRequest(method: string, url: string): boolean {
  if (method !== 'POST') {
    return false
  }
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname.toLowerCase() === 'chatgpt.com' && parsed.pathname.includes('/backend-api')
    )
  } catch {
    return url.includes('chatgpt.com/backend-api')
  }
}

interface CodexPayloadDiagnostics {
  readonly model: unknown
  readonly hasReasoning: boolean
  readonly reasoningEffort: unknown
  readonly isContinuation: boolean
  readonly toolResultCount: number
  readonly toolCount: number
  readonly toolChoice: unknown
}

/**
 * Parameters the Codex `/backend-api/codex/responses` endpoint rejects with
 * `{"detail":"Unsupported parameter: <name>"}`. The endpoint controls output
 * budgets and sampling server-side.
 *
 * @see https://github.com/BerriAI/litellm/issues/21193
 * @see https://github.com/openai/codex/issues/4138
 */
const CODEX_UNSUPPORTED_PARAMS = [
  'max_output_tokens',
  'max_tokens',
  'max_completion_tokens',
  'metadata',
  'user',
  'context_management',
] as const

function stripUnsupportedCodexParams(body: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...body }
  for (const key of CODEX_UNSUPPORTED_PARAMS) {
    delete cleaned[key]
  }
  return cleaned
}

function countToolResults(input: unknown): number {
  if (!Array.isArray(input)) return 0
  let count = 0
  for (const item of input) {
    if (isRecord(item) && item.type === 'function_call_output') count++
  }
  return count
}

function withCodexPayloadDefaults(rawBody: string): {
  body: string
  diagnostics: CodexPayloadDiagnostics | null
} {
  const parsedBody: unknown = JSON.parse(rawBody)
  if (!isRecord(parsedBody)) {
    return { body: rawBody, diagnostics: null }
  }

  const baseFields = stripUnsupportedCodexParams(parsedBody)

  const nextText = isRecord(baseFields.text) ? { ...baseFields.text } : {}
  if (typeof nextText.verbosity !== 'string') {
    nextText.verbosity = 'medium'
  }

  // Preserve any upstream include entries and ensure the Codex-required
  // reasoning.encrypted_content entry is always present.
  const existingInclude = Array.isArray(baseFields.include) ? baseFields.include : []
  const mergedInclude: unknown[] = [...existingInclude]
  if (!mergedInclude.includes(OPENAI_CODEX_REASONING_INCLUDE)) {
    mergedInclude.push(OPENAI_CODEX_REASONING_INCLUDE)
  }

  const payload: Record<string, unknown> = {
    ...baseFields,
    store: false,
    stream: true,
    text: nextText,
    include: mergedInclude,
    tool_choice: baseFields.tool_choice ?? 'auto',
    parallel_tool_calls:
      typeof baseFields.parallel_tool_calls === 'boolean' ? baseFields.parallel_tool_calls : true,
  }

  const toolResultCount = countToolResults(payload.input)
  const diagnostics: CodexPayloadDiagnostics = {
    model: payload.model,
    hasReasoning: isRecord(payload.reasoning),
    reasoningEffort: isRecord(payload.reasoning) ? payload.reasoning.effort : undefined,
    isContinuation: toolResultCount > 0,
    toolResultCount,
    toolCount: Array.isArray(payload.tools) ? payload.tools.length : 0,
    toolChoice: payload.tool_choice,
  }

  return { body: JSON.stringify(payload), diagnostics }
}

function createCodexResponsesFetch(accountId: string): typeof fetch {
  let requestSequence = 0

  return async (input, init) => {
    const method = getRequestMethod(input, init)
    const originalUrl = getRequestUrl(input)
    if (!isChatgptBackendPostRequest(method, originalUrl)) {
      return fetch(input, init)
    }

    const body = init?.body
    const headers = new Headers(init?.headers)
    headers.set('OpenAI-Beta', 'responses=experimental')
    headers.set('originator', 'openwaggle')
    headers.set('accept', 'text/event-stream')
    headers.set('content-type', 'application/json')
    headers.set('chatgpt-account-id', accountId)
    headers.set('User-Agent', OPENAI_CODEX_USER_AGENT)

    let rewrittenBody: BodyInit | null | undefined = body
    if (typeof body === 'string') {
      try {
        const result = withCodexPayloadDefaults(body)
        rewrittenBody = result.body

        // Log each Codex request only when SSE tracing is enabled — these
        // fire on every model turn and continuation, which is noisy for
        // normal operation.
        if (result.diagnostics && codexSseTraceEnabled) {
          requestSequence++
          logger.debug('Codex subscription request', {
            seq: requestSequence,
            ...result.diagnostics,
          })
        }
      } catch {
        rewrittenBody = body
      }
    }

    const rewrittenUrl = resolveCodexResponsesUrl(originalUrl)

    const response = await fetch(rewrittenUrl, {
      ...init,
      headers,
      body: rewrittenBody,
    })
    if (!response.ok) {
      let responsePreview = ''
      try {
        responsePreview = (await response.clone().text()).slice(0, SLICE_ARG_2)
      } catch {
        responsePreview = ''
      }
      logger.warn('OpenAI Codex subscription request failed', {
        status: response.status,
        url: rewrittenUrl,
        responsePreview,
      })
    }
    return response
  }
}

// ─── Context window metadata ──────────────────────────────────

const OPENAI_CONTEXT_272K = 272_000
const OPENAI_CONTEXT_128K = 128_000
const OPENAI_CONTEXT_200K = 200_000
const OPENAI_MAX_OUTPUT_128K = 128_000
const OPENAI_MAX_OUTPUT_100K = 100_000

function getOpenaiContextWindow(model: string): ModelContextWindow | undefined {
  // GPT-5.x family: 272k context (except spark at 128k)
  if (model.includes('gpt-5')) {
    if (model.includes('spark')) {
      return { contextTokens: OPENAI_CONTEXT_128K, maxOutputTokens: OPENAI_MAX_OUTPUT_128K }
    }
    return { contextTokens: OPENAI_CONTEXT_272K, maxOutputTokens: OPENAI_MAX_OUTPUT_128K }
  }
  // o-series reasoning models
  if (/^o[1-4]/.test(model)) {
    return { contextTokens: OPENAI_CONTEXT_200K, maxOutputTokens: OPENAI_MAX_OUTPUT_100K }
  }
  // GPT-4.x family
  if (model.includes('gpt-4')) {
    return { contextTokens: OPENAI_CONTEXT_128K, maxOutputTokens: OPENAI_MAX_OUTPUT_128K }
  }
  return undefined
}

export const openaiProvider: ProviderDefinition = {
  id: 'openai',
  displayName: 'OpenAI',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: true,
  models: OPENAI_CHAT_MODELS,
  testModel: 'gpt-4.1-nano',
  supportsAttachment: (kind) => kind === 'image' || kind === 'pdf',
  getStaticSubscriptionModels: () => [...OPENAI_CODEX_SUBSCRIPTION_MODELS],
  createAdapter(model, apiKey, _baseUrl, authMethod) {
    if (!apiKey) throw new Error('OpenAI API key is required')
    if (authMethod === 'subscription') {
      const accountId = extractChatgptAccountId(apiKey)
      if (!accountId) {
        throw new Error(
          'OpenAI subscription auth token is missing chatgpt_account_id. Please sign in again.',
        )
      }
      return createOpenaiChat(model, apiKey, {
        baseURL: OPENAI_CODEX_BASE_URL,
        fetch: createCodexResponsesFetch(accountId),
      })
    }
    return createOpenaiChat(model, apiKey)
  },
  async fetchModels(_baseUrl, apiKey, authMethod) {
    // Codex subscription: no dynamic fetch possible from chatgpt.com — use curated list
    if (authMethod === 'subscription') return [...OPENAI_CODEX_SUBSCRIPTION_MODELS]
    if (!apiKey || !apiKey.startsWith('sk-')) return [...OPENAI_CHAT_MODELS]
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) return [...OPENAI_CHAT_MODELS]
      const body: unknown = await response.json()
      if (!isRecord(body) || !Array.isArray(body.data)) return [...OPENAI_CHAT_MODELS]
      const chatPrefixes = ['gpt-', 'o1', 'o2', 'o3', 'o4', 'chatgpt-']
      const excludePrefixes = [
        'dall-e',
        'tts',
        'whisper',
        'embedding',
        'babbage',
        'davinci',
        'curie',
        'ada',
      ]
      const models: string[] = []
      for (const entry of body.data) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        const id = entry.id
        if (excludePrefixes.some((p) => id.startsWith(p))) continue
        if (chatPrefixes.some((p) => id.startsWith(p))) {
          models.push(id)
        }
      }
      models.sort((a, b) => b.localeCompare(a))
      return models.length > 0 ? models : [...OPENAI_CHAT_MODELS]
    } catch (err) {
      logger.warn('Failed to fetch OpenAI models dynamically', {
        error: err instanceof Error ? err.message : 'unknown',
      })
      return [...OPENAI_CHAT_MODELS]
    }
  },
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    if (isReasoningModel(model)) {
      return {
        temperature: undefined,
        topP: undefined,
        maxTokens: base.maxTokens * RESOLVE_SAMPLING_VALUE_4,
        modelOptions: { reasoning: { effort: preset, summary: 'auto' } },
      }
    }
    return { temperature: base.temperature, topP: base.topP, maxTokens: base.maxTokens }
  },
  getContextWindow: getOpenaiContextWindow,
}
