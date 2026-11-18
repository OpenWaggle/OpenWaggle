import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { ComposerModelPicker } from '../ComposerModelPicker'

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSettings: vi.fn(),
  },
}))

const CURRENT_MODEL = SupportedModelId('openai/gpt-5')
const NEXT_MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const AUTH = {
  configured: true,
  source: 'api-key',
  apiKeyConfigured: true,
  apiKeySource: 'api-key',
  oauthConnected: false,
  supportsApiKey: true,
  supportsOAuth: true,
} satisfies ProviderInfo['auth']

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    auth: AUTH,
    models: [
      {
        id: CURRENT_MODEL,
        modelId: 'gpt-5',
        name: 'GPT 5',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      },
    ],
  },
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
    auth: AUTH,
    models: [
      {
        id: NEXT_MODEL,
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      },
    ],
  },
]

describe('ComposerModelPicker default-model pick', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        selectedModel: CURRENT_MODEL,
        enabledModels: [CURRENT_MODEL, NEXT_MODEL],
      },
      isLoaded: true,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: PROVIDER_MODELS,
    })
    vi.mocked(api.updateSettings).mockClear().mockResolvedValue({ ok: true })
  })

  it('settles a failed default-model pick instead of floating its rejection', async () => {
    // No Session is open, so the pick writes the default model, which the picker fires with
    // `void`; a transient Settings IPC failure used to surface as an unhandled renderer
    // rejection (Sentry issue OPENWAGGLE-6).
    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ComposerModelPicker />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'GPT 5' }))
    fireEvent.click(screen.getByRole('option', { name: 'Claude Sonnet' }))

    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to pick the model', {
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    )
    // The store kept the previous default, so the next pick can retry it.
    expect(usePreferencesStore.getState().settings.selectedModel).toBe(CURRENT_MODEL)
  })
})
