import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { ComposerToolbar } from '../ComposerToolbar'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
  },
}))

const SELECTED_MODEL = SupportedModelId('openai/gpt-5')
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
        id: SELECTED_MODEL,
        modelId: 'gpt-5',
        name: 'GPT 5',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
]

function renderToolbar(overrides: Partial<Parameters<typeof ComposerToolbar>[0]> = {}) {
  const fileInputRef: React.RefObject<HTMLInputElement | null> = { current: null }
  const defaults = {
    submission: {
      onSend: vi.fn(),
      onCancel: vi.fn(),
      isLoading: false,
      canSend: true,
    },
    onToggleVoice: vi.fn(),
    voiceMode: 'idle' as const,
    fileInputRef,
  }
  return render(<ComposerToolbar {...defaults} {...overrides} />)
}

function submission(overrides: Partial<Parameters<typeof ComposerToolbar>[0]['submission']> = {}) {
  return {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isLoading: false,
    canSend: true,
    ...overrides,
  }
}

describe('ComposerToolbar', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        selectedModel: SELECTED_MODEL,
        enabledModels: [SELECTED_MODEL],
      },
      isLoaded: true,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: PROVIDER_MODELS,
    })
  })

  it('renders thinking level label', () => {
    renderToolbar()
    expect(screen.getByTitle('Select thinking level')).toBeInTheDocument()
  })

  it('keeps controls on one row and establishes a composer-width responsive boundary', () => {
    renderToolbar({
      accessControl: (
        <Button variant="unstyled" type="button">
          YOLO
        </Button>
      ),
    })

    expect(screen.getByTestId('composer-toolbar')).toHaveClass(
      '@container/composer-toolbar',
      '@max-xl/composer-toolbar:px-3',
      'h-11',
      'flex-nowrap',
    )
    expect(screen.getByTestId('composer-toolbar')).not.toHaveClass('flex-wrap')
    expect(screen.getByTestId('composer-toolbar-actions')).toHaveClass(
      'ml-auto',
      'min-w-0',
      '@max-xl/composer-toolbar:gap-1.5',
    )
    expect(screen.getByTestId('composer-toolbar-actions')).not.toHaveClass('shrink-0')
    expect(screen.getByTestId('composer-toolbar-primary-actions')).toHaveClass(
      'shrink-0',
      'flex-nowrap',
    )
    expect(
      screen.getByRole('img', { name: 'Context usage meter' }).parentElement?.parentElement,
    ).toHaveClass('@max-xl/composer-toolbar:hidden')
    expect(screen.getByText('GPT 5')).toHaveClass('@max-xl/composer-toolbar:max-w-20')
    expect(screen.getByTitle('Select thinking level')).toHaveClass(
      '@max-xl/composer-toolbar:size-6.5',
    )
    expect(screen.getByRole('button', { name: 'Thinking level: Medium' })).toBeInTheDocument()
    expect(screen.getByTestId('composer-thinking-compact-icon')).toHaveClass(
      'hidden',
      '@max-xl/composer-toolbar:block',
    )
  })

  it('opens thinking menu on click', () => {
    renderToolbar()
    fireEvent.click(screen.getByTitle('Select thinking level'))
    expect(useComposerStore.getState().thinkingMenuOpen).toBe(true)
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('shows every extended thinking level supplied by Pi, including off and max', () => {
    useProviderStore.setState({
      providerModels: [
        {
          ...PROVIDER_MODELS[0],
          models: [
            {
              ...PROVIDER_MODELS[0].models[0],
              availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
            },
          ],
        },
      ],
    })
    usePreferencesStore.setState({
      settings: {
        ...usePreferencesStore.getState().settings,
        thinkingLevel: 'max',
      },
    })

    renderToolbar()

    expect(screen.getByRole('button', { name: 'Thinking level: Max' })).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Select thinking level'))
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Max' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('opens the composer add menu with the existing context entry points', () => {
    usePreferencesStore.setState({
      settings: {
        ...usePreferencesStore.getState().settings,
        projectPath: '/repo',
      },
    })
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Add to message' }))

    expect(screen.getByRole('menuitem', { name: /Attach files/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Reference project file/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Use a skill/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Start Waggle/ })).toBeInTheDocument()
  })

  it('shows the selected model effective thinking level instead of unsupported xhigh', () => {
    usePreferencesStore.setState({
      settings: {
        ...usePreferencesStore.getState().settings,
        thinkingLevel: 'xhigh',
      },
    })

    renderToolbar()

    expect(screen.getByRole('button', { name: /high/i })).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Extra High is not available for this model; using High'))
    expect(screen.queryByText('Extra High')).not.toBeInTheDocument()
    expect(screen.getAllByText('High')).toHaveLength(2)
  })

  it('maps non-reasoning selected models to off in the toolbar', () => {
    useProviderStore.setState({
      providerModels: [
        {
          ...PROVIDER_MODELS[0],
          models: [
            {
              id: SELECTED_MODEL,
              modelId: 'gpt-5',
              name: 'GPT 5',
              provider: 'openai',
              available: true,
              availableThinkingLevels: ['off'],
            },
          ],
        },
      ],
    })

    renderToolbar()

    expect(screen.getByRole('button', { name: /off/i })).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Selected model does not support thinking'))
    expect(screen.getAllByText('Off')).toHaveLength(2)
    expect(screen.queryByText('Medium')).not.toBeInTheDocument()
  })

  it('renders send button when not loading', () => {
    renderToolbar()
    expect(screen.getByTitle('Send message')).toBeInTheDocument()
  })

  it('renders cancel button when loading', () => {
    renderToolbar({ submission: submission({ isLoading: true }) })
    expect(screen.getByTitle('Cancel')).toBeInTheDocument()
  })

  it('renders both cancel and add-message buttons when loading and canSend', () => {
    renderToolbar({ submission: submission({ isLoading: true, canSend: true }) })
    expect(screen.getByTitle('Cancel')).toBeInTheDocument()
    expect(screen.getByTitle('Add message')).toBeInTheDocument()
  })

  it('calls onSend when send button is clicked', () => {
    const onSend = vi.fn()
    renderToolbar({ submission: submission({ onSend }) })
    fireEvent.click(screen.getByTitle('Send message'))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    renderToolbar({ submission: submission({ isLoading: true, onCancel }) })
    fireEvent.click(screen.getByTitle('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables send button when canSend is false', () => {
    renderToolbar({ submission: submission({ canSend: false }) })
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
