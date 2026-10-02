import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type SessionFollowUpQueueItem,
  type SessionFollowUpQueueSnapshot,
  sessionFollowUpQueueOptions,
} from '@/features/chat/hooks'
import { useBackgroundRunStore, useChatStore, useRunFinishingStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import {
  SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON,
  SESSION_SETTINGS_LOCKED_REASON,
} from '../../lib/session-settings-lock'
import { ComposerModelPicker } from '../ComposerModelPicker'
import { ThinkingLevelMenu } from '../ThinkingLevelMenu'

const api = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({ ok: true }),
  getProviderModels: vi.fn().mockResolvedValue([]),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue(null),
  getDefaultThinkingLevel: vi.fn().mockResolvedValue('medium'),
  setDefaultThinkingLevel: vi.fn().mockResolvedValue(undefined),
  setSessionThinkingLevel: vi.fn().mockResolvedValue({ changed: true }),
  querySessionControl: vi.fn().mockRejectedValue(new Error('No Session Host in this test')),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

const SESSION = SessionId('session-settings-lock')
const MODEL = SupportedModelId('openai/gpt-5')
const PROVIDER_MODELS: ProviderInfo[] = [
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
        id: MODEL,
        modelId: 'gpt-5',
        name: 'GPT 5',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      },
    ],
  },
]

let queryClient = new QueryClient()

function sessionDetail(): SessionDetail {
  return {
    id: SESSION,
    title: 'Settings lock',
    projectPath: '/project',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    executionModel: MODEL,
    executionThinkingLevel: 'medium',
  }
}

function openSession() {
  useChatStore.setState({
    activeSessionId: SESSION,
    activeSession: sessionDetail(),
    sessionById: new Map([[SESSION, sessionDetail()]]),
    refreshSession: vi.fn().mockResolvedValue(undefined),
  })
}

function queuedItem(overrides: Partial<SessionFollowUpQueueItem> = {}): SessionFollowUpQueueItem {
  return {
    id: 'follow-up-1',
    text: 'next',
    attachmentCount: 0,
    createdAt: 1,
    deliveryState: 'pending',
    attachments: [],
    editable: true,
    ...overrides,
  }
}

function seedQueue(snapshot: Partial<SessionFollowUpQueueSnapshot>) {
  queryClient.setQueryData(sessionFollowUpQueueOptions(SESSION).queryKey, {
    state: 'running',
    revision: 1,
    activeRunId: null,
    items: [],
    waitingOnEdit: false,
    ...snapshot,
  })
}

function renderPickers() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ComposerModelPicker />
      <ThinkingLevelMenu />
    </QueryClientProvider>,
  )
}

function pickers() {
  return [
    screen.getByRole('button', { name: 'GPT 5' }),
    screen.getByRole('button', { name: /^Thinking level:/ }),
  ]
}

function expectLocked(reason: string) {
  for (const picker of pickers()) {
    expect(picker).toBeDisabled()
    expect(picker).toHaveAccessibleDescription(reason)
  }
}

function expectUnlocked() {
  for (const picker of pickers()) {
    expect(picker).toBeEnabled()
    expect(picker).not.toHaveAccessibleDescription(SESSION_SETTINGS_LOCKED_REASON)
    expect(picker).not.toHaveAccessibleDescription(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  }
}

describe('composer Session settings pickers', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useChatStore.setState(useChatStore.getInitialState())
    useComposerStore.setState(useComposerStore.getInitialState())
    useBackgroundRunStore.setState(useBackgroundRunStore.getInitialState())
    useRunFinishingStore.setState({ ids: new Set() })
    useUIStore.setState({ toastData: null })
    api.setSessionThinkingLevel.mockReset().mockResolvedValue({ changed: true })
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, selectedModel: MODEL, enabledModels: [MODEL] },
      isLoaded: true,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: PROVIDER_MODELS,
    })
  })

  it('stay enabled for a new Session draft', () => {
    useChatStore.setState({ activeSessionId: null })
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session is idle', () => {
    openSession()
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session waits on a paused queue', () => {
    openSession()
    seedQueue({ state: 'paused', items: [queuedItem()] })
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session waits on a next message held for an edit', () => {
    openSession()
    seedQueue({
      waitingOnEdit: true,
      items: [
        queuedItem({ editHold: { heldByCurrentUser: true, acquiredAt: 1, leaseExpiresAt: 2 } }),
      ],
    })
    renderPickers()

    expectUnlocked()
  })

  it('are disabled with a reason while a Run is active', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('suggest pausing the queue during a chain of queued Runs', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    seedQueue({ items: [queuedItem()] })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  })

  it('stay disabled while a Run is active even with the queue paused, as the Host would refuse', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    seedQueue({ state: 'paused', items: [queuedItem()] })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('stay disabled in the finishing gap, which is still a Run to the Host', () => {
    openSession()
    seedQueue({ items: [queuedItem()] })
    useRunFinishingStore.getState().mark(SESSION)
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  })

  it('are disabled while a Run is still starting, such as a worktree launch', () => {
    openSession()
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION, {
      status: 'running',
      stage: 'preparing-workspace',
      startedAt: 1,
      updatedAt: 1,
      details: [],
    })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('close an open thinking menu when a Run starts, so it stays closed when the Run ends', () => {
    openSession()
    renderPickers()

    fireEvent.click(screen.getByRole('button', { name: /^Thinking level:/ }))
    expect(screen.getByRole('menuitemradio', { name: 'High' })).toBeInTheDocument()
    act(() => useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL))
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).not.toBeInTheDocument()
    expect(useComposerStore.getState().thinkingMenuOpen).toBe(false)
    act(() => useBackgroundRunStore.getState().removeActiveRun(SESSION))

    expectUnlocked()
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).not.toBeInTheDocument()
  })

  it('explain why the model picker waits while a draft creates its Session', () => {
    useChatStore.setState({
      activeSessionId: null,
      draftSession: { projectPath: '/project', isMaterializing: true },
    })
    renderPickers()

    const model = screen.getByRole('button', { name: 'GPT 5' })
    expect(model).toBeDisabled()
    expect(model).toHaveAccessibleDescription('Available once the new Session is created')
  })

  it('keep the level and show a toast when the Host refuses a thinking-level pick', async () => {
    openSession()
    api.setSessionThinkingLevel.mockResolvedValue({ changed: false, code: 'session_run_active' })
    renderPickers()

    fireEvent.click(screen.getByRole('button', { name: /^Thinking level:/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: expect.stringContaining('only while no Run is active'),
        variant: 'error',
      }),
    )
    expect(api.setSessionThinkingLevel).toHaveBeenCalledWith(SESSION, 'high')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Thinking level: Medium' })).toBeInTheDocument(),
    )
  })
})
