import { classifyErrorMessage, makeErrorInfo } from '@shared/types/errors'
import { describe, expect, it } from 'vitest'
import { classifyAgentError } from './error-classifier'

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

  it.each([
    ['429 Too Many Requests', 'rate-limited'],
    ['Rate limit exceeded', 'rate-limited'],
    ['too many requests, please slow down', 'rate-limited'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it.each([
    ['500 Internal Server Error', 'provider-down'],
    ['502 Bad Gateway', 'provider-down'],
    ['503 Service Unavailable', 'provider-down'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it.each([
    ['model gpt-5 not found', 'model-not-found'],
    ['The model does not exist', 'model-not-found'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it.each([
    ['connect ECONNREFUSED 127.0.0.1:443', 'provider-unavailable'],
    ['getaddrinfo ENOTFOUND api.example.com', 'provider-unavailable'],
    ['connect ETIMEDOUT', 'provider-unavailable'],
    ['TypeError: fetch failed', 'provider-unavailable'],
  ])('classifies "%s" as %s', (message, expectedCode) => {
    const info = classifyErrorMessage(message)
    expect(info.code).toBe(expectedCode)
  })

  it('falls back to unknown for unrecognized errors', () => {
    const info = classifyErrorMessage('something completely unexpected')
    expect(info.code).toBe('unknown')
    expect(info.retryable).toBe(true)
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
