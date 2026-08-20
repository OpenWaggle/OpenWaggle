import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentCustomInteractionComposerFallback } from '../AgentCustomInteractionComposerFallback'

describe('AgentCustomInteractionComposerFallback', () => {
  it('lets users reject a custom interaction when no desktop renderer is available', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      interactionId: 'custom-interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'custom',
      customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
      source: 'pi-ui',
      createdAt: 1,
      renderer: { kind: 'pi-tui-custom', supported: false },
    } as const

    render(
      <AgentCustomInteractionComposerFallback
        extensionProjectPaths={[]}
        extensionRegistry={null}
        interactions={[interaction]}
        onRespond={onRespond}
      />,
    )

    expect(screen.getAllByText('Custom interaction')).toHaveLength(2)
    expect(
      screen.queryByText(OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reject interaction' }))

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'custom', value: null })
  })
})
