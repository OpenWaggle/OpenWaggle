import { SessionId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { useWaggleStore } from '@/features/waggle/state'
import { WaggleCollaborationStatus } from '../CollaborationStatus'

const SESSION_ID = SessionId('session-1')
const SELECTED_MODEL = SupportedModelId('openai/gpt-5.5')

function inheritedConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}

describe('WaggleCollaborationStatus', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, selectedModel: SELECTED_MODEL },
      isLoaded: true,
      loadError: null,
    })
  })

  it('renders inherited agent models as the selected standard model without materializing config', () => {
    const config = inheritedConfig()
    useWaggleStore.getState().setConfig(config, SESSION_ID)

    render(<WaggleCollaborationStatus currentSessionId={SESSION_ID} onStop={vi.fn()} />)

    expect(screen.getAllByText(/GPT 5.5/)).toHaveLength(2)
    expect(screen.queryByText(/\$inherit/)).not.toBeInTheDocument()
    expect(screen.getByText(/Waggle ready · Sequential · 4 turns/)).toBeInTheDocument()
    expect(useWaggleStore.getState().activeConfig).toBe(config)
  })

  it('shows current and total turns while running', () => {
    const config = inheritedConfig()
    useWaggleStore.getState().startCollaboration(SESSION_ID, config)
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'turn-start', turnNumber: 1, agentIndex: 1, agentLabel: 'Reviewer' })

    render(<WaggleCollaborationStatus currentSessionId={SESSION_ID} onStop={vi.fn()} />)

    expect(screen.getByText(/Turn 2\/4: Reviewer · GPT 5.5/)).toBeInTheDocument()
  })
})
