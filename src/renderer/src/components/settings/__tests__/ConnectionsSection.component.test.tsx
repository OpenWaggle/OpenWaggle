import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../../stores/auth-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useProviderStore } from '../../../stores/provider-store'
import { ConnectionsSection } from '../sections/ConnectionsSection'

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'openai-codex',
    displayName: 'OpenAI Codex',
    auth: {
      configured: true,
      source: 'oauth',
      apiKeyConfigured: false,
      apiKeySource: 'none',
      oauthConnected: true,
      supportsApiKey: false,
      supportsOAuth: true,
    },
    models: [
      {
        id: SupportedModelId('openai-codex/gpt-5.4'),
        modelId: 'gpt-5.4',
        name: 'GPT 5.4',
        provider: 'openai-codex',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
    ],
  },
  {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    auth: {
      configured: false,
      source: 'none',
      apiKeyConfigured: false,
      apiKeySource: 'none',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: false,
    },
    models: [
      {
        id: SupportedModelId('openrouter/openai/gpt-5.4'),
        modelId: 'openai/gpt-5.4',
        name: 'GPT 5.4',
        provider: 'openrouter',
        available: false,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
    ],
  },
]

describe('ConnectionsSection', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: PROVIDER_MODELS,
    })
    useAuthStore.setState({
      ...useAuthStore.getInitialState(),
      authAccounts: {
        'openai-codex': {
          provider: 'openai-codex',
          connected: true,
          label: 'user@example.com',
        },
      },
    })
  })

  it('renders auth method groups collapsed by default', () => {
    render(<ConnectionsSection />)

    expect(screen.getByRole('heading', { name: 'API Key Providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'OAuth Providers' })).toBeInTheDocument()
    expect(screen.queryByText('OAuth active')).not.toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('renders API-key provider rows from the Pi catalog when expanded', () => {
    render(<ConnectionsSection />)

    fireEvent.click(screen.getByRole('button', { name: /API Key Providers/i }))

    expect(
      screen.queryByRole('button', { name: 'Edit OpenAI Codex API key' }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('OpenRouter').length).toBeGreaterThan(0)
    expect(screen.queryByText('OAuth active')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not configured')).toHaveLength(1)
  })

  it('renders OAuth rows only for Pi providers that support OAuth', () => {
    render(<ConnectionsSection />)

    fireEvent.click(screen.getByRole('button', { name: /OAuth Providers/i }))

    expect(screen.getByRole('heading', { name: 'OAuth Providers' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
  })

  it('collapses auth method groups independently', () => {
    render(<ConnectionsSection />)

    fireEvent.click(screen.getByRole('button', { name: /API Key Providers/i }))
    fireEvent.click(screen.getByRole('button', { name: /OAuth Providers/i }))
    fireEvent.click(screen.getByRole('button', { name: /API Key Providers/i }))

    expect(screen.queryByText('Not configured')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'OAuth Providers' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('starts the Pi OAuth browser flow from the OAuth provider row', () => {
    const startOAuth = vi.fn()
    useAuthStore.setState({
      authAccounts: {
        'openai-codex': {
          provider: 'openai-codex',
          connected: false,
          label: 'Not connected',
        },
      },
      startOAuth,
    })

    render(<ConnectionsSection />)

    fireEvent.click(screen.getByRole('button', { name: /OAuth Providers/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenAI Codex' }))

    expect(startOAuth).toHaveBeenCalledWith('openai-codex')
  })

  it('keeps the OAuth toggle enabled during authentication so users can cancel', () => {
    const cancelOAuth = vi.fn()
    useAuthStore.setState({
      authAccounts: {
        'openai-codex': {
          provider: 'openai-codex',
          connected: false,
          label: 'Not connected',
        },
      },
      oauthStatuses: {
        'openai-codex': { type: 'awaiting-code', provider: 'openai-codex' },
      },
      cancelOAuth,
    })

    render(<ConnectionsSection />)

    fireEvent.click(screen.getByRole('button', { name: /OAuth Providers/i }))
    const toggle = screen.getByRole('button', { name: 'Cancel OpenAI Codex sign in' })

    expect(toggle).not.toBeDisabled()
    fireEvent.click(toggle)
    expect(cancelOAuth).toHaveBeenCalledWith('openai-codex')
  })

  it('renders all Pi catalog models in settings regardless of availability', () => {
    render(<ConnectionsSection />)

    expect(screen.getByRole('heading', { name: 'Available Models' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /OpenAI Codex.*selected/i }))
    fireEvent.click(screen.getByRole('button', { name: /OpenRouter.*selected/i }))

    expect(screen.getAllByText('GPT 5.4')).toHaveLength(2)
    expect(screen.getByText('Auth required')).toBeInTheDocument()
  })

  it('renders an empty Pi catalog message when no providers are reported', () => {
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: [],
    })

    render(<ConnectionsSection />)

    expect(screen.getByText(/pi did not report any providers or models/i)).toBeInTheDocument()
  })
})
