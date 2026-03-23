import { SupportedModelId } from '@shared/types/brand'
import type { ProviderConfig } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetProviderForModel = vi.hoisted(() => vi.fn())
const mockGetActiveApiKey = vi.hoisted(() => vi.fn())

vi.mock('../registry', () => ({
  providerRegistry: {
    getProviderForModel: mockGetProviderForModel,
  },
}))

vi.mock('../../auth', () => ({
  getActiveApiKey: mockGetActiveApiKey,
}))

vi.mock('../../agent/quality-config', () => ({
  resolveQualityConfig: vi.fn(() => ({
    temperature: 0.7,
    maxTokens: 4096,
  })),
}))

import {
  buildSamplingOptions,
  isResolutionError,
  resolveProviderAndQuality,
} from '../provider-resolver'

const fakeProvider = {
  id: 'anthropic' as const,
  displayName: 'Anthropic',
  requiresApiKey: true,
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: false,
  models: ['claude-sonnet-4-5'],
  testModel: 'claude-sonnet-4-5',
  createAdapter: () => ({}) as never,
  supportsAttachment: () => true,
}

const enabledConfig: ProviderConfig = {
  enabled: true,
  apiKey: 'sk-test-key',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildSamplingOptions', () => {
  it('returns temperature when provided', () => {
    expect(buildSamplingOptions({ temperature: 0.5 })).toEqual({ temperature: 0.5 })
  })

  it('returns topP when provided', () => {
    expect(buildSamplingOptions({ topP: 0.9 })).toEqual({ topP: 0.9 })
  })

  it('returns both when both provided', () => {
    expect(buildSamplingOptions({ temperature: 0.5, topP: 0.9 })).toEqual({
      temperature: 0.5,
      topP: 0.9,
    })
  })

  it('returns empty object when neither provided', () => {
    expect(buildSamplingOptions({})).toEqual({})
  })
})

describe('isResolutionError', () => {
  it('returns true for error result', () => {
    expect(isResolutionError({ ok: false, reason: 'test' })).toBe(true)
  })

  it('returns false for success result', () => {
    const result = {
      ok: true as const,
      provider: fakeProvider,
      providerConfig: enabledConfig,
      resolvedModel: SupportedModelId('claude-sonnet-4-5'),
      qualityConfig: {
        model: SupportedModelId('claude-sonnet-4-5'),
        temperature: 0.7,
        maxTokens: 4096,
      },
    }
    expect(isResolutionError(result)).toBe(false)
  })
})

describe('resolveProviderAndQuality', () => {
  it('returns error when no provider found for model', async () => {
    mockGetProviderForModel.mockReturnValue(undefined)

    const result = await resolveProviderAndQuality(SupportedModelId('unknown-model'), 'medium', {})

    expect(isResolutionError(result)).toBe(true)
    if (!result.ok) {
      expect(result.reason).toContain('No provider registered')
    }
  })

  it('returns error when provider is disabled', async () => {
    mockGetProviderForModel.mockReturnValue(fakeProvider)

    const result = await resolveProviderAndQuality(
      SupportedModelId('claude-sonnet-4-5'),
      'medium',
      { anthropic: { enabled: false, apiKey: 'sk-key' } },
    )

    expect(isResolutionError(result)).toBe(true)
    if (!result.ok) {
      expect(result.reason).toContain('disabled')
    }
  })

  it('returns error when API key is missing', async () => {
    mockGetProviderForModel.mockReturnValue(fakeProvider)

    const result = await resolveProviderAndQuality(
      SupportedModelId('claude-sonnet-4-5'),
      'medium',
      { anthropic: { enabled: true, apiKey: '' } },
    )

    expect(isResolutionError(result)).toBe(true)
    if (!result.ok) {
      expect(result.reason).toContain('No API key')
    }
  })

  it('returns resolved result on success', async () => {
    mockGetProviderForModel.mockReturnValue(fakeProvider)

    const result = await resolveProviderAndQuality(
      SupportedModelId('claude-sonnet-4-5'),
      'medium',
      { anthropic: enabledConfig },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provider).toBe(fakeProvider)
      expect(result.resolvedModel).toBe('claude-sonnet-4-5')
      expect(result.providerConfig.apiKey).toBe('sk-test-key')
    }
  })

  it('refreshes subscription token when auth method is subscription', async () => {
    mockGetProviderForModel.mockReturnValue(fakeProvider)
    mockGetActiveApiKey.mockResolvedValue('fresh-token')

    const result = await resolveProviderAndQuality(
      SupportedModelId('claude-sonnet-4-5'),
      'medium',
      { anthropic: { enabled: true, apiKey: 'old-token', authMethod: 'subscription' } },
    )

    expect(mockGetActiveApiKey).toHaveBeenCalledWith('anthropic')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.providerConfig.apiKey).toBe('fresh-token')
    }
  })

  it('returns error when subscription token refresh fails', async () => {
    mockGetProviderForModel.mockReturnValue(fakeProvider)
    mockGetActiveApiKey.mockResolvedValue(null)

    const result = await resolveProviderAndQuality(
      SupportedModelId('claude-sonnet-4-5'),
      'medium',
      { anthropic: { enabled: true, apiKey: 'old-token', authMethod: 'subscription' } },
    )

    expect(isResolutionError(result)).toBe(true)
    if (!result.ok) {
      expect(result.reason).toContain('Session expired')
    }
  })
})
