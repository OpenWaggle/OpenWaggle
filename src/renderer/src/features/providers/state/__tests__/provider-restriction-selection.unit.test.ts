import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../provider-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function openAiProviderModels() {
  return [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      auth: {
        configured: true,
        source: 'api-key',
        apiKeyConfigured: true,
        apiKeySource: 'api-key',
        oauthConnected: false,
        supportsApiKey: true,
        supportsOAuth: true,
      },
      models: [
        {
          id: SupportedModelId('openai/gpt-4.1-mini'),
          modelId: 'gpt-4.1-mini',
          name: 'GPT 4.1 Mini',
          provider: 'openai',
          available: true,
          availableThinkingLevels: ['off'],
        },
      ],
    },
  ] satisfies ProviderInfo[]
}

function ollamaProviderModels() {
  return [
    {
      provider: 'ollama',
      displayName: 'Ollama',
      auth: {
        configured: true,
        source: 'environment-or-custom',
        apiKeyConfigured: true,
        apiKeySource: 'environment-or-custom',
        oauthConnected: false,
        supportsApiKey: true,
        supportsOAuth: false,
      },
      models: [
        {
          id: SupportedModelId('ollama/llama3.2:latest'),
          modelId: 'llama3.2:latest',
          name: 'Llama 3.2',
          provider: 'ollama',
          available: true,
          availableThinkingLevels: ['off'],
        },
      ],
    },
  ] satisfies ProviderInfo[]
}

describe('provider restrictions in the selection store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderStore.setState({
      providerModels: [],
      projectProviderOverride: undefined,
    })
  })

  it('moves a disallowed selection to the first enabled model of an allowed provider', async () => {
    const [openAi] = openAiProviderModels()
    const [ollama] = ollamaProviderModels()
    if (!openAi || !ollama) throw new Error('missing fixture')
    const settings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/projects/personal/repo',
      selectedModel: SupportedModelId('openai/gpt-4.1-mini'),
      enabledModels: [
        SupportedModelId('openai/gpt-4.1-mini'),
        SupportedModelId('ollama/llama3.2:latest'),
      ],
      providerRestrictions: { openai: false },
    }
    apiMock.getProviderModels.mockResolvedValue([openAi, ollama])

    await useProviderStore.getState().loadProviderModels(settings)

    expect(apiMock.updateSettings).toHaveBeenCalledWith({
      selectedModel: 'ollama/llama3.2:latest',
    })
  })

  it('keeps a selection the project file scope allows despite the app-wide choice', async () => {
    const [openAi] = openAiProviderModels()
    if (!openAi) throw new Error('missing fixture')
    const settings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/projects/acme/repo',
      selectedModel: SupportedModelId('openai/gpt-4.1-mini'),
      enabledModels: [SupportedModelId('openai/gpt-4.1-mini')],
      providerRestrictions: { openai: false },
    }
    useProviderStore.setState({
      projectProviderOverride: { openai: true },
      providerModels: [openAi],
    })

    const reconciled = await useProviderStore.getState().reconcileProjectSelection(settings)

    expect(reconciled).toBeNull()
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
  })
})
