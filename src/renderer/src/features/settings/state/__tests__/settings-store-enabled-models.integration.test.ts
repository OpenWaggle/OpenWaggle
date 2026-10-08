import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    setEnabledModels: vi.fn(),
    updateSettings: vi.fn(),
    setProjectPreferences: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { usePreferencesStore } from '../preferences-store'

const SIGNED_OUT = SupportedModelId('anthropic/claude-sonnet-4-5')
const AVAILABLE = SupportedModelId('openai/gpt-4.1-mini')

function provider(id: string, name: string, model: SupportedModelId, available: boolean) {
  return {
    provider: id,
    displayName: name,
    auth: {
      configured: available,
      source: available ? 'api-key' : 'none',
      apiKeyConfigured: available,
      apiKeySource: available ? 'api-key' : 'none',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: false,
    },
    models: [
      {
        id: model,
        modelId: model.split('/')[1] ?? model,
        name,
        provider: id,
        available,
        availableThinkingLevels: ['off'],
      },
    ],
  } satisfies ProviderInfo
}

describe('enabling models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.setEnabledModels.mockResolvedValue(undefined)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    apiMock.setProjectPreferences.mockResolvedValue('/repo/demo')
    useProviderStore.setState({
      providerModels: [
        provider('anthropic', 'Anthropic', SIGNED_OUT, false),
        provider('openai', 'OpenAI', AVAILABLE, true),
      ],
      catalogHydrated: true,
    })
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/repo/demo',
        selectedModel: SupportedModelId('qa-faux/luna'),
      },
      isLoaded: true,
      loadError: null,
    })
  })

  it('selects the first enabled model this project can run, not the first one listed', async () => {
    await usePreferencesStore.getState().setEnabledModels([SIGNED_OUT, AVAILABLE])

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ selectedModel: AVAILABLE })
    expect(usePreferencesStore.getState().settings.selectedModel).toBe(AVAILABLE)
  })
})
