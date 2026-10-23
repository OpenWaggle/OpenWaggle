import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore, useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { ConnectionsSection } from '../sections/ConnectionsSection'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getProviderModels: vi.fn(),
    getAuthAccountInfo: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

vi.mock('../sections/connections/SourceControlSection', () => ({
  SourceControlSection: () => <h3>Source control</h3>,
}))

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
        availableThinkingLevels: ['off'],
      },
    ],
  },
]

describe('ConnectionsSection after the provider catalog failed to load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      loadError: 'Pi catalog unavailable',
      catalogHydrated: true,
    })
    useAuthStore.setState(useAuthStore.getInitialState())
  })

  it('shows the failure with a retry that reloads the catalog and its sign-ins', async () => {
    apiMock.getProviderModels.mockResolvedValue(PROVIDER_MODELS)
    apiMock.getAuthAccountInfo.mockResolvedValue({
      provider: 'openai-codex',
      connected: true,
      label: 'user@example.com',
    })

    render(<ConnectionsSection />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to load providers: Pi catalog unavailable',
    )
    const retry = screen.getByRole('button', { name: 'Retry loading providers' })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Connections' })).toHaveFocus()
    expect(apiMock.getProviderModels).toHaveBeenCalledWith(DEFAULT_SETTINGS.projectPath)
    await waitFor(() => expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openai-codex'))
    fireEvent.click(screen.getByRole('button', { name: /OAuth Providers/i }))
    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
  })

  it('keeps the banner, busy, while the retry runs', async () => {
    let rejectCatalog = (_error: Error) => {}
    apiMock.getProviderModels.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCatalog = reject
      }),
    )

    render(<ConnectionsSection />)
    const retry = screen.getByRole('button', { name: 'Retry loading providers' })
    fireEvent.click(retry)

    expect(screen.getByRole('alert')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Pi catalog unavailable')
    expect(retry).toHaveTextContent('Retrying…')
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(retry)
    expect(apiMock.getProviderModels).toHaveBeenCalledTimes(1)

    rejectCatalog(new Error('Pi catalog still unavailable'))
    expect(await screen.findByText(/Pi catalog still unavailable/)).toBeInTheDocument()
  })

  it('keeps the failure, its retry, and focus on Retry when the retry fails too', async () => {
    apiMock.getProviderModels.mockRejectedValue(new Error('Pi catalog still unavailable'))

    render(<ConnectionsSection />)
    const retry = screen.getByRole('button', { name: 'Retry loading providers' })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load providers: Pi catalog still unavailable',
      ),
    )
    await waitFor(() => expect(retry).toHaveTextContent('Retry'))
    expect(retry).toHaveFocus()
    expect(retry).not.toHaveAttribute('aria-disabled')
    expect(apiMock.getAuthAccountInfo).not.toHaveBeenCalled()
  })
})
