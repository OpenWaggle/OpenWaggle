import { describe, expect, it } from 'vitest'
import { isOAuthProvider } from '../auth'

describe('isOAuthProvider', () => {
  it('returns true for any non-empty Pi OAuth provider id', () => {
    expect(isOAuthProvider('openrouter')).toBe(true)
    expect(isOAuthProvider('openai-codex')).toBe(true)
    expect(isOAuthProvider('google-gemini-cli')).toBe(true)
    expect(isOAuthProvider('not-yet-known-to-openwaggle')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isOAuthProvider('')).toBe(false)
  })

  it('returns false for whitespace-only strings', () => {
    expect(isOAuthProvider('   ')).toBe(false)
  })
})
