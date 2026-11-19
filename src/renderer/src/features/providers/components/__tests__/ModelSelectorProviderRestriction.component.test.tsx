import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { ModelSelector } from '../ModelSelector/ModelSelector'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
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
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off'],
      },
    ],
  },
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
]

function TestHarness({ onChange }: { onChange: (model: string) => void }) {
  const settings = usePreferencesStore((s) => s.settings)
  const providerModels = useProviderStore((s) => s.providerModels)
  return (
    <ModelSelector
      value={settings.selectedModel}
      onChange={onChange}
      settings={settings}
      providerModels={providerModels}
    />
  )
}

function seedStore(overrides?: { settings?: Partial<Settings> }) {
  const nextSettings: Settings = {
    ...DEFAULT_SETTINGS,
    ...overrides?.settings,
  }
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    isLoaded: true,
    settings: nextSettings,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    providerModels: PROVIDER_MODELS,
  })
}

describe('ModelSelector provider restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedStore()
  })

  it('filters enabled models to the providers the project allows', () => {
    seedStore({
      settings: {
        projectPath: '/projects/personal/repo',
        providerRestrictions: { anthropic: false },
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('anthropic/claude-sonnet-4-5'),
          SupportedModelId('openai/gpt-4.1-mini'),
        ],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /select model/i }))

    expect(screen.queryByRole('option', { name: 'Claude Sonnet 4.5' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'GPT 4.1 Mini' })).toBeInTheDocument()
  })

  it('names the allowed providers when the restriction leaves no enabled model', () => {
    seedStore({
      settings: {
        projectPath: '/projects/acme/repo',
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('anthropic/claude-sonnet-4-5'),
          SupportedModelId('gemini/gemini-2.5-flash'),
        ],
      },
    })
    useProviderStore.setState({ projectProviderOverride: { only: ['openai'] } })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /select model/i }))

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText(/this project allows openai/i, { exact: false })).toBeInTheDocument()
  })
})
