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
  it('keeps the transcript row visible when a custom desktop renderer is unavailable', () => {
    render(
      <InteractionEventRow
        item={{ request: customInteractionRequest() }}
        extensions={extensions}
      />,
    )

    expect(screen.getAllByText('Custom interaction')).toHaveLength(3)
    expect(
      screen.queryByText(OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Custom desktop interaction renderer unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/does not execute terminal UI custom components inside Electron/),
    ).toBeInTheDocument()
  })
})
