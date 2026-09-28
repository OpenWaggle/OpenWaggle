import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { ComposerModelPicker } from '../ComposerModelPicker'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    getSessionDetail: vi.fn().mockResolvedValue(null),
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

function sessionDetail(id: SessionId, executionModel: SupportedModelId): SessionDetail {
  return {
    id,
    title: 'Model switch',
    projectPath: '/project',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    executionModel,
  }
}

function openSession(id: SessionId, storedAfterRefresh: SupportedModelId) {
  vi.mocked(api.getSessionDetail).mockResolvedValue(sessionDetail(id, storedAfterRefresh))
  useChatStore.setState({
    activeSessionId: id,
    activeSession: sessionDetail(id, CURRENT_MODEL),
    sessionById: new Map([[id, sessionDetail(id, CURRENT_MODEL)]]),
  })
}

function pickNextModel() {
  fireEvent.click(screen.getByRole('button', { name: 'GPT 5' }))
  fireEvent.click(screen.getByRole('option', { name: 'Claude Sonnet' }))
}

describe('ComposerModelPicker for an existing Session', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState())
    useBackgroundRunStore.setState(useBackgroundRunStore.getInitialState())
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
    vi.mocked(api.setSessionModel).mockReset().mockResolvedValue(undefined)
  })

  it('switches the model of an idle Session without changing the default for new Sessions', async () => {
    const sessionId = SessionId('session-switch-model')
    openSession(sessionId, NEXT_MODEL)
    render(<ComposerModelPicker />)

    expect(screen.getByRole('button', { name: 'GPT 5' })).toBeEnabled()
    pickNextModel()

    expect(useChatStore.getState().activeSession?.executionModel).toBe(NEXT_MODEL)
    expect(useChatStore.getState().sessionById.get(sessionId)?.executionModel).toBe(NEXT_MODEL)
    await waitFor(() => expect(api.setSessionModel).toHaveBeenCalledWith(sessionId, NEXT_MODEL))
    expect(await screen.findByRole('button', { name: 'Claude Sonnet' })).toBeInTheDocument()
    expect(screen.queryByText('Next message')).not.toBeInTheDocument()
    expect(usePreferencesStore.getState().settings.selectedModel).toBe(CURRENT_MODEL)
  })

  it('leaves the running turn on its model and applies a mid-turn pick to the next message', async () => {
    const sessionId = SessionId('session-mid-turn-model')
    openSession(sessionId, NEXT_MODEL)
    useBackgroundRunStore.getState().addActiveRun(sessionId, CURRENT_MODEL)
    render(<ComposerModelPicker />)

    expect(screen.queryByText('Next message')).not.toBeInTheDocument()
    pickNextModel()

    await waitFor(() => expect(api.setSessionModel).toHaveBeenCalledWith(sessionId, NEXT_MODEL))
    const trigger = await screen.findByRole('button', { name: 'Claude Sonnet' })
    expect(trigger).toHaveAttribute('title', expect.stringContaining('next message'))
    expect(trigger).toHaveAttribute('title', expect.stringContaining('keeps using GPT 5'))
    expect(screen.getByText('Next message')).toBeInTheDocument()
    expect(useBackgroundRunStore.getState().runModelBySessionId.get(sessionId)).toBe(CURRENT_MODEL)

    // The next Run starts with the new model, so the pick is no longer pending.
    useBackgroundRunStore.getState().removeActiveRun(sessionId)
    useBackgroundRunStore.getState().addActiveRun(sessionId, NEXT_MODEL)
    await waitFor(() => expect(screen.queryByText('Next message')).not.toBeInTheDocument())
  })

  it('rolls the pick back and says so when the Session Host rejects it', async () => {
    const sessionId = SessionId('session-rejected-model')
    openSession(sessionId, CURRENT_MODEL)
    vi.mocked(api.setSessionModel).mockRejectedValueOnce(new Error('Host unavailable'))
    render(<ComposerModelPicker />)

    pickNextModel()

    expect(await screen.findByRole('button', { name: 'GPT 5' })).toBeInTheDocument()
    expect(useChatStore.getState().activeSession?.executionModel).toBe(CURRENT_MODEL)
    expect(useUIStore.getState().toastData).toMatchObject({
      message: expect.stringContaining('Host unavailable'),
      variant: 'error',
    })
  })
})
