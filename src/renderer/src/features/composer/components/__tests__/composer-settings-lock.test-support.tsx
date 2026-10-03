import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { type RenderResult, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, vi } from 'vitest'
import {
  type SessionFollowUpQueueItem,
  type SessionFollowUpQueueSnapshot,
  sessionFollowUpQueueOptions,
} from '@/features/chat/hooks'
import {
  useBackgroundRunStore,
  useChatStore,
  useQueuedRunStartStore,
  useRunFinishingStore,
} from '@/features/chat/state'
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

/** Shared fixtures for the composer Session settings lock tests. Each test file mocks the IPC. */
export const SESSION = SessionId('session-settings-lock')
export const MODEL = SupportedModelId('openai/gpt-5')
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

export function openSession() {
  useChatStore.setState({
    activeSessionId: SESSION,
    activeSession: sessionDetail(),
    sessionById: new Map([[SESSION, sessionDetail()]]),
    refreshSession: vi.fn().mockResolvedValue(undefined),
  })
}

export function queuedItem(
  overrides: Partial<SessionFollowUpQueueItem> = {},
): SessionFollowUpQueueItem {
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

export function seedQueue(snapshot: Partial<SessionFollowUpQueueSnapshot>) {
  queryClient.setQueryData(sessionFollowUpQueueOptions(SESSION).queryKey, {
    state: 'running',
    revision: 1,
    activeRunId: null,
    items: [],
    waitingOnEdit: false,
    ...snapshot,
  })
}

export function renderPickers(extra?: ReactNode): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      {extra}
      <ComposerModelPicker />
      <ThinkingLevelMenu />
    </QueryClientProvider>,
  )
}

export function pickers() {
  return [
    screen.getByRole('button', { name: 'GPT 5' }),
    screen.getByRole('button', { name: /^Thinking level:/ }),
  ]
}

// Locked pickers stay focusable (`aria-disabled`) so a keyboard user can reach the reason.
export function expectLocked(reason: string) {
  for (const picker of pickers()) {
    expect(picker).toBeEnabled()
    expect(picker).toHaveAttribute('aria-disabled', 'true')
    expect(picker).toHaveAccessibleDescription(reason)
  }
}

export function expectUnlocked() {
  for (const picker of pickers()) {
    expect(picker).not.toHaveAttribute('aria-disabled')
    expect(picker).not.toHaveAccessibleDescription(SESSION_SETTINGS_LOCKED_REASON)
    expect(picker).not.toHaveAccessibleDescription(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  }
}

/** Fresh stores and query cache, with one enabled model that supports thinking levels. */
export function resetPickers() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useChatStore.setState(useChatStore.getInitialState())
  useComposerStore.setState(useComposerStore.getInitialState())
  useBackgroundRunStore.setState(useBackgroundRunStore.getInitialState())
  useRunFinishingStore.setState({ ids: new Set() })
  useQueuedRunStartStore.setState(useQueuedRunStartStore.getInitialState())
  useUIStore.setState({ toastData: null })
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: { ...DEFAULT_SETTINGS, selectedModel: MODEL, enabledModels: [MODEL] },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    providerModels: PROVIDER_MODELS,
  })
}
