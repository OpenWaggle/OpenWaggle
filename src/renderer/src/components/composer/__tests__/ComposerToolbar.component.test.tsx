import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'
import { ComposerToolbar } from '../ComposerToolbar'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getModelCompatibility: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/hooks/useChat', () => ({
  useChat: vi.fn(() => ({
    activeConversation: null,
    conversations: [],
    activeConversationId: null,
    setActiveConversation: vi.fn(),
    createConversation: vi.fn(),
    startDraftThread: vi.fn(),
    updateConversationProjectPath: vi.fn(),
  })),
}))

vi.mock('@/queries/conversations', () => ({
  useTogglePlanModeMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}))

function renderToolbar(overrides: Partial<Parameters<typeof ComposerToolbar>[0]> = {}) {
  const fileInputRef = { current: null } as React.RefObject<HTMLInputElement | null>
  const defaults = {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isLoading: false,
    canSend: true,
    onToggleVoice: vi.fn(),
    voiceMode: 'idle' as const,
    fileInputRef,
  }
  return render(<ComposerToolbar {...defaults} {...overrides} />)
}

describe('ComposerToolbar', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: [],
    })
  })

  it('renders quality preset label', () => {
    renderToolbar()
    expect(screen.getByTitle('Select quality preset')).toBeInTheDocument()
  })

  it('opens quality menu on click', () => {
    renderToolbar()
    fireEvent.click(screen.getByTitle('Select quality preset'))
    expect(useComposerStore.getState().qualityMenuOpen).toBe(true)
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders send button when not loading', () => {
    renderToolbar()
    expect(screen.getByTitle('Send message')).toBeInTheDocument()
  })

  it('renders cancel button when loading', () => {
    renderToolbar({ isLoading: true })
    expect(screen.getByTitle('Cancel')).toBeInTheDocument()
  })

  it('renders both cancel and add-message buttons when loading and canSend', () => {
    renderToolbar({ isLoading: true, canSend: true })
    expect(screen.getByTitle('Cancel')).toBeInTheDocument()
    expect(screen.getByTitle('Add message')).toBeInTheDocument()
  })

  it('calls onSend when send button is clicked', () => {
    const onSend = vi.fn()
    renderToolbar({ onSend })
    fireEvent.click(screen.getByTitle('Send message'))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    renderToolbar({ isLoading: true, onCancel })
    fireEvent.click(screen.getByTitle('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables send button when canSend is false', () => {
    renderToolbar({ canSend: false })
    const button = screen.getByTitle('Send message')
    expect(button).toBeDisabled()
  })

  it('shows mic button that toggles voice', () => {
    const onToggleVoice = vi.fn()
    renderToolbar({ onToggleVoice })
    fireEvent.click(screen.getByTitle('Start voice input'))
    expect(onToggleVoice).toHaveBeenCalledOnce()
  })

  it('shows transcribing state for mic button', () => {
    renderToolbar({ voiceMode: 'transcribing' })
    expect(screen.getByTitle('Transcribing audio')).toBeInTheDocument()
  })
})
