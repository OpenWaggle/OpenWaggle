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

    expect(screen.getAllByText('Custom interaction').length).toBeGreaterThan(0)
    // Counting would stay green if a raw identifier were appended to the label, so this asserts the
    // identifier cannot appear anywhere in the rendered output.
    expect(document.body.textContent).not.toContain(
      OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    )
    expect(screen.getByText('Custom desktop interaction renderer unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/does not execute terminal UI custom components inside Electron/),
    ).toBeInTheDocument()
  })
})

function notifyRequest(level: 'info' | 'warning' | 'error'): AgentTransportInteractionRequestEvent {
  return {
    type: 'agent_interaction_request',
    timestamp: 1,
    interaction: {
      interactionId: `notify-${level}`,
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'notify',
      source: 'pi-ui',
      createdAt: 1,
      message: `Notice at ${level} level`,
      level,
    },
  }
}

describe('InteractionEventRow notification durability', () => {
  it('renders a warning and an error notice', () => {
    const { unmount } = render(
      <InteractionEventRow extensions={extensions} item={{ request: notifyRequest('warning') }} />,
    )
    expect(screen.getByText('Notice at warning level')).toBeInTheDocument()
    unmount()

    render(
      <InteractionEventRow extensions={extensions} item={{ request: notifyRequest('error') }} />,
    )
    expect(screen.getByText('Notice at error level')).toBeInTheDocument()
  })

  it('renders nothing for an informational notice', () => {
    // Informational notices are ephemeral and leave no durable record. This row styles anything that
    // is not an error as a warning, so reaching it would dress an info notice as one.
    const { container } = render(
      <InteractionEventRow extensions={extensions} item={{ request: notifyRequest('info') }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
