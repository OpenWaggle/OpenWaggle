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

    it('classifies unknown errors as unknown', () => {
      expect(classifyErrorMessage('Something completely unexpected').code).toBe('unknown')
    })
  })
})
