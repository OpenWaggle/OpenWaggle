import { describe, expect, it } from 'vitest'
import { generateDisplayName } from './llm'

describe('generateDisplayName', () => {
  it('applies brand capitalization for known model families', () => {
    expect(generateDisplayName('gpt-4.1-mini')).toBe('GPT 4.1 Mini')
    expect(generateDisplayName('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
    expect(generateDisplayName('deepseek-r1')).toBe('DeepSeek R1')
  })

  it('strips provider prefixes for slash-delimited model ids', () => {
    expect(generateDisplayName('anthropic/claude-opus-4')).toBe('Claude Opus 4')
    expect(generateDisplayName('openai/gpt-4.1-nano')).toBe('GPT 4.1 Nano')
  })

  it('capitalizes unknown prefixes while keeping number tokens stable', () => {
    expect(generateDisplayName('my-model-2-preview')).toBe('My Model 2 Preview')
  })
})
