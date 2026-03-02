import type { QualityPreset } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import { isReasoningModel } from '../agent/quality-config'
import { createLogger } from '../logger'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

const logger = createLogger('openai-provider')
const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const OPENAI_CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const OPENAI_CODEX_REASONING_INCLUDE = 'reasoning.encrypted_content'
const OPENAI_CODEX_USER_AGENT = `pi (${process.platform} ${process.release?.name ?? 'node'}; ${process.arch})`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function extractChatgptAccountId(accessToken: string): string | null {
  const segments = accessToken.split('.')
  if (segments.length !== 3) {
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

function withCodexPayloadDefaults(rawBody: string): string {
  const parsedBody: unknown = JSON.parse(rawBody)
  if (!isRecord(parsedBody)) {
    return rawBody
  }
  const { max_output_tokens: _ignoredMaxOutputTokens, ...parsedBodyWithoutMaxOutputTokens } =
    parsedBody

  const nextText = isRecord(parsedBodyWithoutMaxOutputTokens.text)
    ? { ...parsedBodyWithoutMaxOutputTokens.text }
    : {}
  if (typeof nextText.verbosity !== 'string') {
    nextText.verbosity = 'medium'
  }

  const payload: Record<string, unknown> = {
    ...parsedBodyWithoutMaxOutputTokens,
    store: false,
    stream: true,
    text: nextText,
    include: [OPENAI_CODEX_REASONING_INCLUDE],
    tool_choice: parsedBodyWithoutMaxOutputTokens.tool_choice ?? 'auto',
    parallel_tool_calls:
      typeof parsedBodyWithoutMaxOutputTokens.parallel_tool_calls === 'boolean'
        ? parsedBodyWithoutMaxOutputTokens.parallel_tool_calls
        : true,
  }
  return JSON.stringify(payload)
}

function createCodexResponsesFetch(accountId: string): typeof fetch {
  return async (input, init) => {
    const method = getRequestMethod(input, init)
    const originalUrl = getRequestUrl(input)
    if (!isChatgptBackendPostRequest(method, originalUrl)) {
      return fetch(input, init)
    }

    const body = init?.body
    const headers = new Headers(init?.headers)
    headers.set('OpenAI-Beta', 'responses=experimental')
    headers.set('originator', 'pi')
    headers.set('accept', 'text/event-stream')
    headers.set('content-type', 'application/json')
    headers.set('chatgpt-account-id', accountId)
    headers.set('User-Agent', OPENAI_CODEX_USER_AGENT)

    const rewrittenBody =
      typeof body === 'string'
        ? (() => {
            try {
              return withCodexPayloadDefaults(body)
            } catch {
              return body
            }
          })()
        : body

    const rewrittenUrl = resolveCodexResponsesUrl(originalUrl)
    const response = await fetch(rewrittenUrl, {
      ...init,
      headers,
      body: rewrittenBody,
    })
    if (!response.ok) {
      let responsePreview = ''
      try {
        responsePreview = (await response.clone().text()).slice(0, 512)
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

export const openaiProvider: ProviderDefinition = {
  id: 'openai',
  displayName: 'OpenAI',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: false,
  models: OPENAI_CHAT_MODELS,
  testModel: 'gpt-4.1-nano',
  supportsAttachment: (kind) => kind === 'image' || kind === 'pdf',
  createAdapter(model, apiKey, _baseUrl, authMethod) {
    if (!includes(OPENAI_CHAT_MODELS, model)) throw new Error(`Unknown OpenAI model: ${model}`)
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
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    if (isReasoningModel(model)) {
      return {
        temperature: undefined,
        topP: undefined,
        maxTokens: base.maxTokens * 4,
        modelOptions: { reasoning: { effort: preset, summary: 'auto' } },
      }
    }
    return { temperature: base.temperature, topP: base.topP, maxTokens: base.maxTokens }
  },
}
