import { describe, expect, it } from 'vitest'
import {
  renameLegacyProviderCredentials,
  renameLegacyProviderPiSettings,
} from '../pi-provider-renames'

describe('Pi provider renames', () => {
  it("rewrites Pi settings' default provider, enabled model patterns, and per-model thinking levels", () => {
    const settings = {
      defaultProvider: 'azure-openai-responses',
      defaultModel: 'gpt-5.4',
      enabledModels: [
        'azure-openai-responses/*',
        'openai/gpt-5.4',
        'azure-openai-responses/gpt-5.5',
      ],
      modelThinkingLevels: {
        'azure-openai-responses/gpt-5.4': 'high',
        'openai/gpt-5.4': 'low',
      },
      theme: 'dark',
    }

    expect(renameLegacyProviderPiSettings(settings)).toEqual({
      defaultProvider: 'azure',
      defaultModel: 'gpt-5.4',
      enabledModels: ['azure/*', 'openai/gpt-5.4', 'azure/gpt-5.5'],
      modelThinkingLevels: { 'azure/gpt-5.4': 'high', 'openai/gpt-5.4': 'low' },
      theme: 'dark',
    })
  })

  it('returns the same settings object when nothing names the old provider', () => {
    const settings = { defaultProvider: 'openai', enabledModels: ['openai/*'] }

    expect(renameLegacyProviderPiSettings(settings)).toBe(settings)
  })

  it('keeps a per-model thinking level already set under the new provider name', () => {
    expect(
      renameLegacyProviderPiSettings({
        modelThinkingLevels: {
          'azure-openai-responses/gpt-5.4': 'high',
          'azure/gpt-5.4': 'low',
        },
      }),
    ).toEqual({ modelThinkingLevels: { 'azure/gpt-5.4': 'low' } })
  })

  it('copies a stored Azure credential to the new provider key and keeps the old one for older Pi', () => {
    const credential = {
      type: 'api_key',
      key: 'secret',
      env: { AZURE_OPENAI_BASE_URL: 'https://x' },
    }

    expect(renameLegacyProviderCredentials({ 'azure-openai-responses': credential })).toEqual({
      'azure-openai-responses': credential,
      azure: credential,
    })
  })

  it('never overwrites a credential already stored under the new provider key', () => {
    const credentials = {
      'azure-openai-responses': { type: 'api_key', key: 'old' },
      azure: { type: 'api_key', key: 'new' },
    }

    expect(renameLegacyProviderCredentials(credentials)).toBe(credentials)
  })
})
