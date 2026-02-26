import type { GitStatusSummary } from '@shared/types/git'
import type { Settings } from '@shared/types/settings'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { type RenderOptions, type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import { useComposerStore } from '@/stores/composer-store'
import { useGitStore } from '@/stores/git-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { resetRefreshTokens, useProviderStore } from '@/stores/provider-store'

// ── Mock IPC API ──

export function createMockApi() {
  return {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    selectProjectFolder: vi.fn().mockResolvedValue(null),
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'test-conv', messages: [] }),
    getConversation: vi.fn().mockResolvedValue(null),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    updateConversationProjectPath: vi.fn().mockResolvedValue(null),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    commitGit: vi.fn().mockResolvedValue({ ok: true, summary: 'test' }),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
    transcribeVoiceLocal: vi.fn().mockResolvedValue({ text: '', model: 'tiny' }),
    testApiKey: vi.fn().mockResolvedValue({ success: true }),
    onStreamChunk: vi.fn().mockReturnValue(() => {}),
    onOrchestrationEvent: vi.fn().mockReturnValue(() => {}),
    listOrchestrationRuns: vi.fn().mockResolvedValue([]),
    cancelOrchestrationRun: vi.fn().mockResolvedValue(undefined),
  }
}

// ── Store Reset ──

export function resetStores(overrides?: {
  settings?: Partial<Settings>
  gitStatus?: GitStatusSummary | null
}) {
  useComposerStore.setState(useComposerStore.getInitialState())
  useChatStore.setState(useChatStore.getInitialState())

  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: { ...DEFAULT_SETTINGS, ...overrides?.settings },
    isLoaded: true,
  })
  useProviderStore.setState(useProviderStore.getInitialState())
  resetRefreshTokens()
  useAuthStore.setState(useAuthStore.getInitialState())

  useGitStore.setState({
    ...useGitStore.getInitialState(),
    status: overrides?.gitStatus ?? null,
  })
}

// ── Render helper ──

export function renderWithStores(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    settings?: Partial<Settings>
    gitStatus?: GitStatusSummary | null
  },
): RenderResult {
  const { settings, gitStatus, ...renderOptions } = options ?? {}
  resetStores({ settings, gitStatus })
  return render(ui, renderOptions)
}

// ── Fixtures ──

export const MOCK_GIT_STATUS: GitStatusSummary = {
  branch: 'main',
  additions: 42,
  deletions: 18,
  filesChanged: 5,
  changedFiles: [],
  clean: false,
  ahead: 0,
  behind: 0,
}
