import { describe, expect, it } from 'vitest'
import { classifyErrorMessage } from '../error-classifier'

describe('classifyErrorMessage', () => {
  describe('context-overflow', () => {
    it.each([
      ['prompt is too long', 'Anthropic prompt too long'],
      ['prompt_too_long', 'Anthropic error code'],
      ['maximum context length exceeded', 'OpenAI context length'],
      ['context_length_exceeded', 'OpenAI error code'],
      ['exceeds the maximum number of tokens', 'Anthropic token limit'],
      ['exceeds the maximum token limit', 'Gemini token limit'],
      ['Request context has too many tokens', 'Generic context too many tokens'],
    ])('classifies "%s" as context-overflow (%s)', (message) => {
      const result = classifyErrorMessage(message)
      expect(result.code).toBe('context-overflow')
      expect(result.retryable).toBe(true)
    })

    it('does not classify rate-limited "too many tokens" as context-overflow', () => {
      const result = classifyErrorMessage('429 rate limit: too many tokens per minute')
      expect(result.code).toBe('rate-limited')
    })

    it('does not classify generic "tokens" 400 error as context-overflow', () => {
      const result = classifyErrorMessage('400 Invalid request: field tokens validation failed')
      expect(result.code).toBe('unknown')
    })
  })

  describe('existing classifications still work', () => {
    it('classifies 401 as api-key-invalid', () => {
      expect(classifyErrorMessage('401 Unauthorized').code).toBe('api-key-invalid')
    })

    it('classifies 429 as rate-limited', () => {
      expect(classifyErrorMessage('429 Too Many Requests').code).toBe('rate-limited')
    })

    it('classifies credit errors correctly', () => {
      expect(classifyErrorMessage('Your credit balance is too low').code).toBe(
        'insufficient-credits',
      )
    })

    it('keeps the HTTP status and error type of a JSON provider error for classification', () => {
      const openRouter402 =
        '402 {"type":"error","error":{"type":"billing_error","message":"This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford 45715."}}'
      const result = classifyErrorMessage(openRouter402)
      expect(result.code).toBe('insufficient-credits')
      expect(result.message).toMatch(/^This request requires more credits/)
    })

    it('classifies unknown errors as unknown', () => {
      expect(classifyErrorMessage('Something completely unexpected').code).toBe('unknown')
    })
  })

  describe('runtime package manager errors', () => {
    it('classifies Pi npm startup failures as runtime-package-manager-unavailable', () => {
      const result = classifyErrorMessage('Failed to run npm root -g: undefined')

      expect(result.code).toBe('runtime-package-manager-unavailable')
      expect(result.retryable).toBe(false)
    })
  })

  describe('pi-session-file-deleted', () => {
    it('shows the whole message for a Session whose Pi file was deleted, even with a path that looks like another error', () => {
      const message =
        "This Session's Pi session file was deleted outside OpenWaggle (/home/me/401-unauthorized/s.jsonl), so its history is gone and it cannot be continued. Restore the file to continue it. The Session stays, to read, because fork abc still depends on it."

      const info = classifyErrorMessage(`Error: ${message}`)

      expect(info.code).toBe('pi-session-file-deleted')
      expect(info.userMessage).toBe(message)
      expect(info.retryable).toBe(false)
    })
  })
})
