import type { ConversationId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { UIMessage } from '@tanstack/ai-react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
import { useSettingsStore } from '@/stores/settings-store'
import { ChatPanel } from '../ChatPanel'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
  },
}))

const ORCHESTRATION_DEFAULTS = {
  orchestrationRuns: [],
  orchestrationEvents: [],
  onCancelOrchestrationRun: vi.fn(),
}

function makeMessage(
  overrides: Partial<UIMessage> & { id: string; role: 'user' | 'assistant' },
): UIMessage {
  return {
    parts: [],
    ...overrides,
  } as UIMessage
}

function renderPanel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const defaults = {
    messages: [] as UIMessage[],
    isLoading: false,
    error: undefined,
    projectPath: '/test/project',
    hasProject: true,
    conversationId: 'conv-1' as ConversationId,
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onToolApprovalResponse: vi.fn().mockResolvedValue(undefined),
    onAnswerQuestion: vi.fn().mockResolvedValue(undefined),
    model: 'claude-sonnet-4-20250514' as const,
    messageModelLookup: {},
    slashSkills: [],
    orchestration: ORCHESTRATION_DEFAULTS,
    recentProjects: [],
  }
  return render(<ChatPanel {...defaults} {...overrides} />)
}

describe('ChatPanel', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useSettingsStore.setState({
      ...useSettingsStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      providerModels: [],
    })
  })

  it('shows welcome screen when no messages', () => {
    renderPanel()
    expect(screen.getByText("Let's build")).toBeInTheDocument()
  })

  it('shows thinking indicator when loading with no assistant message', () => {
    renderPanel({ isLoading: true })
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('renders messages when present', () => {
    const messages: UIMessage[] = [
      makeMessage({ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Hello agent' }] }),
    ]
    renderPanel({ messages })
    // Should not show welcome screen
    expect(screen.queryByText(/open a project/i)).toBeNull()
  })

  it('renders the composer input area', () => {
    renderPanel()
    // Composer renders — look for the textarea
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not show thinking when loading but last message is assistant', () => {
    const messages: UIMessage[] = [
      makeMessage({ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Hi' }] }),
      makeMessage({ id: 'a1', role: 'assistant', parts: [{ type: 'text', content: 'Hello!' }] }),
    ]
    renderPanel({ messages, isLoading: true })
    expect(screen.queryByText('Thinking...')).toBeNull()
  })
})
