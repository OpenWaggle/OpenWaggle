import { classifyErrorMessage, makeErrorInfo } from '@shared/types/errors'
import { describe, expect, it } from 'vitest'
import { classifyAgentError } from '../error-classifier'

describe('makeErrorInfo', () => {
  it('builds info from a known code', () => {
    const info = makeErrorInfo('api-key-invalid', 'raw 401 from provider')
    expect(info.code).toBe('api-key-invalid')
    expect(info.message).toBe('raw 401 from provider')
    expect(info.userMessage).toBe('Invalid API key')
    expect(info.suggestion).toBe('Check your API key in Settings.')
    expect(info.retryable).toBe(false)
  })

  it('builds unknown info with retryable true', () => {
    const info = makeErrorInfo('unknown', 'something broke')
    expect(info.code).toBe('unknown')
    expect(info.retryable).toBe(true)
  })
})

describe('classifyErrorMessage', () => {
  it.each([
    ['401 Unauthorized', 'api-key-invalid'],
    ['Invalid API key provided', 'api-key-invalid'],
    ['Authentication failed', 'api-key-invalid'],
    ['incorrect api key', 'api-key-invalid'],
    ['Error: unauthorized access', 'api-key-invalid'],
    ['403 Forbidden', 'api-key-invalid'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  // ─── Credit / billing errors — per-provider coverage ───────────

  describe('insufficient credits (Anthropic)', () => {
    it.each([
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
    ])('classifies Anthropic credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  describe('insufficient credits (OpenAI)', () => {
    it.each([
      'You exceeded your current quota, please check your plan and billing details.',
      '429 {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}',
      'Error code: insufficient_quota - You exceeded your current quota.',
      'OpenAI API error: insufficient_quota',
    ])('classifies OpenAI credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  describe('insufficient credits (Gemini)', () => {
    it.each([
      '429 {"error":{"code":429,"message":"Quota exceeded for quota metric","status":"RESOURCE_EXHAUSTED"}}',
      'RESOURCE_EXHAUSTED: Quota exceeded for project',
      'Quota exceeded for quota metric',
    ])('classifies Gemini credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  describe('insufficient credits (Grok/xAI)', () => {
    it.each([
      'Your team abc123 has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.',
      'monthly spending limit reached',
    ])('classifies Grok credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  describe('insufficient credits (OpenRouter)', () => {
    it.each([
      'Your account or API key has insufficient credits.',
      '402 {"error":{"code":402,"message":"Your account or API key has insufficient credits."}}',
      'Payment required',
      'You requested up to 229018 tokens, but can only afford 92985. Payment required.',
    ])('classifies OpenRouter credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  describe('insufficient credits (generic)', () => {
    it.each([
      'out of credits',
      'purchase credits to continue',
    ])('classifies generic credit error: %s', (message) => {
      const info = classifyErrorMessage(message)
      expect(info.code).toBe('insufficient-credits')
    })
  })

  it('does not misclassify billing address errors as credit errors', () => {
    const info = classifyErrorMessage('Please update your billing address')
    expect(info.code).not.toBe('insufficient-credits')
  })

  it('does not misclassify subscription-gated payment errors as credit errors', () => {
    const info = classifyErrorMessage('PaymentRequired: This feature requires a Pro subscription')
    expect(info.code).not.toBe('insufficient-credits')
  })

  it('classifies messages with both "api key" and credit terms as credits (not auth)', () => {
    const info = classifyErrorMessage('Your API key has insufficient credits')
    expect(info.code).toBe('insufficient-credits')
  })

  // ─── Rate limiting ──────────────────────────────────────────────

  it.each([
    ['429 Too Many Requests', 'rate-limited'],
    ['Rate limit exceeded', 'rate-limited'],
    ['too many requests, please slow down', 'rate-limited'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it('classifies 429 without credit context as rate-limited (not credits)', () => {
    const info = classifyErrorMessage('429 Too Many Requests - please try again later')
    expect(info.code).toBe('rate-limited')
  })

  it('classifies model-runner wrapped Anthropic 429 with clean message', () => {
    const raw =
      'Model error [429]: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CYbC6m5kckZcZoHLfL3Ru"}'
    const info = classifyErrorMessage(raw)
    expect(info.code).toBe('rate-limited')
    expect(info.message).toBe(
      "This request would exceed your account's rate limit. Please try again later.",
    )
  })

  // ─── Provider down ──────────────────────────────────────────────

  it.each([
    ['500 Internal Server Error', 'provider-down'],
    ['502 Bad Gateway', 'provider-down'],
    ['503 Service Unavailable', 'provider-down'],
    ['529 Overloaded', 'provider-down'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it('classifies Anthropic 529 overloaded JSON wrapper as provider-down with clean message', () => {
    const raw = '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
    const info = classifyErrorMessage(raw)
    expect(info.code).toBe('provider-down')
    expect(info.message).toBe('Overloaded')
    expect(info.userMessage).toBe('Provider is temporarily unavailable')
  })

  // ─── Model not found ───────────────────────────────────────────

  it.each([
    ['model gpt-5 not found', 'model-not-found'],
    ['The model does not exist', 'model-not-found'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  // ─── Network / connectivity ─────────────────────────────────────

  it.each([
    ['connect ECONNREFUSED 127.0.0.1:443', 'provider-unavailable'],
    ['getaddrinfo ENOTFOUND api.example.com', 'provider-unavailable'],
    ['connect ETIMEDOUT', 'provider-unavailable'],
    ['TypeError: fetch failed', 'provider-unavailable'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  // ─── Unknown fallback ──────────────────────────────────────────

  it('falls back to unknown for unrecognized errors', () => {
    const info = classifyErrorMessage('something completely unexpected')
    expect(info.code).toBe('unknown')
    expect(info.retryable).toBe(true)
  })
})

describe('extractInnerErrorMessage (via classifyErrorMessage)', () => {
  it('extracts inner message from Anthropic JSON wrapper', () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Credit balance too low"}}'
    const info = classifyErrorMessage(raw)
    // Display message should be the extracted inner message, not the raw wrapper
    expect(info.message).toBe('Credit balance too low')
  })

  it('extracts inner message from OpenAI JSON wrapper', () => {
    const raw =
      '429 {"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}'
    const info = classifyErrorMessage(raw)
    expect(info.message).toBe('You exceeded your current quota')
  })

  it('keeps Gemini status out of display message but uses it for classification', () => {
    const raw =
      '429 {"error":{"code":429,"message":"Resource limit hit","status":"RESOURCE_EXHAUSTED"}}'
    const info = classifyErrorMessage(raw)
    // Display message should NOT contain the [RESOURCE_EXHAUSTED] suffix
    expect(info.message).toBe('Resource limit hit')
    // But it should still classify as credits thanks to RESOURCE_EXHAUSTED in classifyTarget
    expect(info.code).toBe('insufficient-credits')
  })

  it('falls back to raw message when JSON is malformed', () => {
    const raw = '429 {not valid json'
    const info = classifyErrorMessage(raw)
    expect(info.message).toBe(raw)
  })

  it('falls back to raw message when JSON has no message fields', () => {
    const raw = '400 {"type":"error","code":400}'
    const info = classifyErrorMessage(raw)
    expect(info.message).toBe(raw)
  })

  it('extracts top-level message when error.message is absent', () => {
    const raw = '{"message":"Something went wrong"}'
    const info = classifyErrorMessage(raw)
    expect(info.message).toBe('Something went wrong')
  })
})

describe('classifyAgentError', () => {
  it('extracts message from Error objects', () => {
    const info = classifyAgentError(new Error('401 Unauthorized'))
    expect(info.code).toBe('api-key-invalid')
  })

  it('handles non-Error values', () => {
    const info = classifyAgentError('plain string 401')
    expect(info.code).toBe('api-key-invalid')
  })

  it('handles null/undefined', () => {
    const info = classifyAgentError(null)
    expect(info.code).toBe('unknown')
  })
})
