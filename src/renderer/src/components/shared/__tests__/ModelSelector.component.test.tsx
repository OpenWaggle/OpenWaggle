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
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: true,
    supportsDynamicModelFetch: false,
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
    ],
  },
  {
    provider: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: true,
    supportsDynamicModelFetch: false,
    models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
  },
  {
    provider: 'gemini',
    displayName: 'Gemini',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' }],
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
      value={settings.defaultModel}
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
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...overrides?.settings?.providers,
    },
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
        defaultModel: 'claude-sonnet-4-5',
        enabledModels: [
          'anthropic:api-key:claude-sonnet-4-5',
          'anthropic:api-key:claude-opus-4-5',
          'gemini:api-key:gemini-2.5-flash',
        ],
        providers: {
          ...DEFAULT_SETTINGS.providers,
          anthropic: { apiKey: 'anthropic-key', enabled: true },
          openai: { apiKey: '', enabled: false },
          gemini: { apiKey: 'gemini-key', enabled: true },
        },
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
      expect(onChange).toHaveBeenCalledWith('gemini-2.5-flash', 'api-key')
    })
  })

  it('deduplicates repeated model entries', () => {
    seedStore({
      providerModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: false,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [
            { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
            { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
          ],
        },
      ],
      settings: {
        defaultModel: 'llama3.2:latest',
        enabledModels: ['ollama:api-key:llama3.2:latest', 'ollama:api-key:llama3.2:latest'],
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: { apiKey: '', enabled: true },
        },
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
        defaultModel: 'claude-sonnet-4-5',
        enabledModels: ['anthropic:api-key:claude-sonnet-4-5', 'gemini:api-key:gemini-2.5-flash'],
        providers: {
          ...DEFAULT_SETTINGS.providers,
          anthropic: { apiKey: 'anthropic-key', enabled: true },
          gemini: { apiKey: 'gemini-key', enabled: true },
        },
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
        defaultModel: 'claude-sonnet-4-5',
        enabledModels: [],
        providers: {
          ...DEFAULT_SETTINGS.providers,
          anthropic: { apiKey: 'anthropic-key', enabled: true },
          gemini: { apiKey: 'gemini-key', enabled: true },
        },
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
})
