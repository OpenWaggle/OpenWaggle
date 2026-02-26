import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings-store'
import { ModelSelector } from '../ModelSelector'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    testApiKey: vi.fn(),
    showConfirm: vi.fn(),
    startOAuth: vi.fn(),
    onOAuthStatus: vi.fn().mockReturnValue(() => {}),
    getAuthAccountInfo: vi.fn(),
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
    models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
  },
  {
    provider: 'gemini',
    displayName: 'Gemini',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: false,
    models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' }],
  },
]

interface TestHarnessProps {
  onChange: (model: string) => void
}

function TestHarness({ onChange }: TestHarnessProps): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const providerModels = useSettingsStore((s) => s.providerModels)

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

  useSettingsStore.setState({
    ...useSettingsStore.getInitialState(),
    isLoaded: true,
    settings: nextSettings,
    providerModels: overrides?.providerModels ?? PROVIDER_MODELS,
  })
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedStore({
      settings: {
        defaultModel: 'claude-sonnet-4-5',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          anthropic: { apiKey: 'anthropic-key', enabled: true },
          openai: { apiKey: '', enabled: false },
          gemini: { apiKey: 'gemini-key', enabled: true },
        },
      },
    })
  })

  it('renders provider rail tabs and filters by provider', async () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    expect(screen.getByLabelText('Show favorite models')).toBeInTheDocument()
    expect(screen.getByLabelText('Show Anthropic models')).toBeInTheDocument()
    expect(screen.getByLabelText('Show OpenAI models')).toBeInTheDocument()
    expect(screen.getByLabelText('Search models')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show Gemini models'))
    expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument()
    expect(screen.queryByText('Claude Opus 4.5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Gemini 2.5 Flash'))
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('gemini-2.5-flash')
    })
  })

  it('keeps provider tab filtering scoped to provider groups when model metadata is mismatched', () => {
    seedStore({
      providerModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: false,
          supportsSubscription: false,
          models: [
            {
              id: 'llama3.2:latest',
              name: 'Llama3.2:latest',
              provider: 'gemini',
            },
          ],
        },
        {
          provider: 'gemini',
          displayName: 'Gemini',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: false,
          models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' }],
        },
      ],
      settings: {
        defaultModel: 'gemini-2.5-flash',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          gemini: { apiKey: 'gemini-key', enabled: true },
          ollama: { apiKey: '', enabled: true },
        },
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /gemini 2\.5 flash/i }))
    fireEvent.click(screen.getByLabelText('Show Gemini models'))

    expect(screen.getByRole('option', { name: 'Gemini 2.5 Flash' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Llama3.2:latest' })).not.toBeInTheDocument()
  })

  it('deduplicates repeated provider model entries', () => {
    seedStore({
      providerModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: false,
          supportsSubscription: false,
          models: [
            { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
            { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
          ],
        },
      ],
      settings: {
        defaultModel: 'llama3.2:latest',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: { apiKey: '', enabled: true },
        },
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /llama3\.2:latest/i }))
    fireEvent.click(screen.getByLabelText('Show Ollama models'))

    expect(screen.getAllByRole('option', { name: 'Llama3.2:latest' })).toHaveLength(1)
  })

  it('filters models by search query', () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'opus' } })

    expect(screen.getByText('Claude Opus 4.5')).toBeInTheDocument()
    expect(screen.getAllByText('Claude Sonnet 4.5')).toHaveLength(1)
  })

  it('favorites and unfavorites models from the row star button', async () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Add Claude Opus 4.5 to favorites' }))

    await waitFor(() => {
      expect(apiMock.updateSettings).toHaveBeenCalledWith({
        favoriteModels: ['claude-opus-4-5'],
      })
    })
    expect(useSettingsStore.getState().settings.favoriteModels).toEqual(['claude-opus-4-5'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove Claude Opus 4.5 from favorites' }))
    await waitFor(() => {
      expect(apiMock.updateSettings).toHaveBeenCalledWith({ favoriteModels: [] })
    })
    expect(useSettingsStore.getState().settings.favoriteModels).toEqual([])
  })

  it('blocks selection for models missing required API keys', () => {
    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))
    fireEvent.click(screen.getByLabelText('Show OpenAI models'))

    expect(screen.getByText('Set API key in Connections')).toBeInTheDocument()
    fireEvent.click(screen.getByText('GPT 4.1 Mini'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('auto-enables a provider before selecting its model', async () => {
    seedStore({
      settings: {
        defaultModel: 'claude-sonnet-4-5',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          anthropic: { apiKey: 'anthropic-key', enabled: true },
          gemini: { apiKey: 'gemini-key', enabled: false },
        },
      },
    })

    const onChange = vi.fn()
    render(<TestHarness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /claude sonnet 4\.5/i }))
    fireEvent.click(screen.getByLabelText('Show Gemini models'))
    fireEvent.click(screen.getByText('Gemini 2.5 Flash'))

    await waitFor(() => {
      expect(apiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            gemini: expect.objectContaining({ enabled: true }),
          }),
        }),
      )
    })
    expect(onChange).toHaveBeenCalledWith('gemini-2.5-flash')
  })
})
