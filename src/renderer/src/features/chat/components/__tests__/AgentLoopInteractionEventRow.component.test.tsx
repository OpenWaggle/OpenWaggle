import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportInteractionRequestEvent } from '@shared/types/stream'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InteractionEventRow } from '../AgentLoopInteractionEventRow'

const extensions = {
  registry: { projectPaths: ['/test/project'], entries: [] },
  projectPaths: ['/test/project'],
}

function customInteractionRequest(): AgentTransportInteractionRequestEvent {
  return {
    type: 'agent_interaction_request',
    timestamp: 1,
    interaction: {
      interactionId: 'custom-interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'custom',
      customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
      source: 'pi-ui',
      createdAt: 1,
      renderer: { kind: 'pi-tui-custom', supported: false },
    },
  }
}

describe('InteractionEventRow', () => {
  it('keeps the transcript audit row visible when a custom desktop renderer is unavailable', () => {
    render(<InteractionEventRow event={customInteractionRequest()} extensions={extensions} />)

    expect(screen.getByText('Interaction requested')).toBeInTheDocument()
    expect(
      screen.getByText(
        `Custom interaction · ${OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Custom desktop interaction renderer unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/does not execute Pi TUI custom components inside Electron/),
    ).toBeInTheDocument()
  })
})
