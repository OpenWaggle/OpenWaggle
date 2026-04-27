import { describe, expect, it } from 'vitest'
import { supportsPiApiKeyAuthProvider } from '../pi-provider-service'

describe('supportsPiApiKeyAuthProvider', () => {
  const oauthProviders = new Set([
    'anthropic',
    'github-copilot',
    'google-antigravity',
    'google-gemini-cli',
    'openai-codex',
  ])
  const builtInModelProviders = new Set([
    'anthropic',
    'deepseek',
    'github-copilot',
    'google-antigravity',
    'google-gemini-cli',
    'openai',
    'openai-codex',
    'openrouter',
  ])

  it('keeps Pi OAuth-only providers out of the API-key auth section', () => {
    expect(
      supportsPiApiKeyAuthProvider('openai-codex', 'none', oauthProviders, builtInModelProviders),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider('github-copilot', 'none', oauthProviders, builtInModelProviders),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider(
        'google-antigravity',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider(
        'google-gemini-cli',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(false)
  })

  it('keeps providers with Pi API-key auth in the API-key auth section', () => {
    expect(
      supportsPiApiKeyAuthProvider('anthropic', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('deepseek', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('openai', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('openrouter', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
  })

  it('treats custom non-OAuth model providers as Pi API-key login providers', () => {
    expect(
      supportsPiApiKeyAuthProvider(
        'private-gateway',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(true)
  })

  it('keeps configured custom auth visible even when provider metadata changes', () => {
    expect(
      supportsPiApiKeyAuthProvider(
        'private-oauth',
        'environment-or-custom',
        new Set(['private-oauth']),
        builtInModelProviders,
      ),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider(
        'private-oauth',
        'api-key',
        new Set(['private-oauth']),
        builtInModelProviders,
      ),
    ).toBe(true)
  })
})
