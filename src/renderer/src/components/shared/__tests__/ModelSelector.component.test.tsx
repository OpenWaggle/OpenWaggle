import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'
import { ModelSelector } from '../ModelSelector'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    setEnabledModels: vi.fn().mockResolvedValue(undefined),
    testApiKey: vi.fn(),
    showConfirm: vi.fn(),
    startOAuth: vi.fn(),
    cancelOAuth: vi.fn(),
    onOAuthStatus: vi.fn().mockReturnValue(() => {}),
    getAuthAccountInfo: vi.fn(),
    submitAuthCode: vi.fn(),
    disconnectAuth: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
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
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('anthropic/claude-opus-4-5'),
        modelId: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
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
  {
    provider: 'gemini',
    displayName: 'Gemini',

    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: false,
    },
    models: [
      {
        id: SupportedModelId('gemini/gemini-2.5-flash'),
        modelId: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'gemini',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
]

interface TestHarnessProps {
  onChange: (model: string) => void
}

function TestHarness({ onChange }: TestHarnessProps): React.JSX.Element {
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

function seedStore(overrides?: {
  settings?: Partial<Settings>
  providerModels?: ProviderInfo[]
}): void {
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
    providerModels: overrides?.providerModels ?? PROVIDER_MODELS,
  })
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedStore({
      settings: {
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('anthropic/claude-sonnet-4-5'),
          SupportedModelId('anthropic/claude-opus-4-5'),
          SupportedModelId('gemini/gemini-2.5-flash'),
        ],
      },
    })
  })

  it('shows flat list of models from enabledModels', () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    // Anthropic models visible (in enabledModels)
    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude Opus 4.5' })).toBeInTheDocument()

    // Gemini models visible (in enabledModels)
    expect(screen.getByRole('option', { name: 'Gemini 2.5 Flash' })).toBeInTheDocument()

    // OpenAI not visible (not in enabledModels)
    expect(screen.queryByRole('option', { name: 'GPT 4.1 Mini' })).not.toBeInTheDocument()
  })

  it('selects a model and closes dropdown', async () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))
    fireEvent.click(screen.getByRole('option', { name: 'Gemini 2.5 Flash' }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('gemini/gemini-2.5-flash')
    })
  })

  it('deduplicates repeated model entries', () => {
    seedStore({
      providerModels: [
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
              name: 'Llama3.2:latest',
              provider: 'ollama',
              available: true,
              availableThinkingLevels: ['off'],
            },
            {
              id: SupportedModelId('ollama/llama3.2:latest'),
              modelId: 'llama3.2:latest',
              name: 'Llama3.2:latest',
              provider: 'ollama',
              available: true,
              availableThinkingLevels: ['off'],
            },
          ],
        },
      ],
      settings: {
        selectedModel: SupportedModelId('ollama/llama3.2:latest'),
        enabledModels: [
          SupportedModelId('ollama/llama3.2:latest'),
          SupportedModelId('ollama/llama3.2:latest'),
        ],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /llama3\.2:latest/i }))
    expect(screen.getAllByRole('option', { name: 'Llama3.2:latest' })).toHaveLength(1)
  })

  it('filters to only enabledModels when set', () => {
    seedStore({
      settings: {
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('anthropic/claude-sonnet-4-5'),
          SupportedModelId('gemini/gemini-2.5-flash'),
        ],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Gemini 2.5 Flash' })).toBeInTheDocument()
    // Claude Opus excluded by enabledModels filter
    expect(screen.queryByRole('option', { name: 'Claude Opus 4.5' })).not.toBeInTheDocument()
  })

  it('shows no models when enabledModels is empty', () => {
    seedStore({
      settings: {
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    // Button shows "Select model" since no models are in the flat list
    fireEvent.click(screen.getByRole('button', { name: /select model/i }))

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('omits models not in enabledModels', () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    // OpenAI not in enabledModels → no models shown
    expect(screen.queryByRole('option', { name: 'GPT 4.1 Mini' })).not.toBeInTheDocument()
  })

  it('excludes stale enabledModels entries not in current provider catalog', () => {
    seedStore({
      settings: {
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('anthropic/claude-sonnet-4-5'), // valid — exists in providerModels
          SupportedModelId('anthropic/claude-opus-4-5-20251101'), // stale — version suffix doesn't match
          SupportedModelId('openai/gpt-5.4'), // stale — no openai model with this ID in catalog
        ],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    // Valid model appears
    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeInTheDocument()
    // Stale entries do not appear (no raw IDs like 'claude-opus-4-5-20251101')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('excludes providerless model IDs from dropdown', () => {
    seedStore({
      settings: {
        selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
        enabledModels: [
          SupportedModelId('gpt-5.4'),
          SupportedModelId('anthropic/claude-sonnet-4-5'),
        ],
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeInTheDocument()
  })
})
