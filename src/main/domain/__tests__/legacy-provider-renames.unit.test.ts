import { describe, expect, it } from 'vitest'
import {
  renameLegacyProviderId,
  renameLegacyProviderModelReference,
} from '../legacy-provider-renames'

describe('legacy provider renames', () => {
  it('maps the Pi 1.0.3 Azure rename for provider ids and model references', () => {
    expect(renameLegacyProviderId('azure-openai-responses')).toBe('azure')
    expect(renameLegacyProviderModelReference('azure-openai-responses/gpt-5.4')).toBe(
      'azure/gpt-5.4',
    )
  })

  it('leaves every other provider and look-alike reference untouched', () => {
    expect(renameLegacyProviderId('openai')).toBe('openai')
    expect(renameLegacyProviderModelReference('openai/gpt-5.4')).toBe('openai/gpt-5.4')
    expect(renameLegacyProviderModelReference('azure-openai-responses-proxy/gpt-5')).toBe(
      'azure-openai-responses-proxy/gpt-5',
    )
    expect(renameLegacyProviderModelReference('openrouter/azure-openai-responses/gpt-5')).toBe(
      'openrouter/azure-openai-responses/gpt-5',
    )
  })
})
