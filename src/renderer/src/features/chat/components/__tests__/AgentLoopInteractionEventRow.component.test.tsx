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

function notifyRequest(
  level: 'info' | 'warning' | 'error',
  message = `Notice at ${level} level`,
): AgentTransportInteractionRequestEvent {
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
      message,
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

const UNBROKEN_TOKEN = `/very/long/path/${'segment'.repeat(40)}`

function confirmRequest(message: string): AgentTransportInteractionRequestEvent {
  return {
    type: 'agent_interaction_request',
    timestamp: 1,
    interaction: {
      interactionId: 'confirm-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: 1,
      purpose: 'user-input',
      title: 'Run this command?',
      message,
    },
  }
}

function rowSection(container: HTMLElement) {
  const section = container.querySelector('section')
  if (!(section instanceof HTMLElement)) {
    throw new Error('Expected the interaction row section')
  }
  return section
}

describe('InteractionEventRow layout', () => {
  // jsdom does no layout, so these pin the classes that keep the card inside the transcript column.
  // An implicit grid track grows to its widest min-content child (a truncated line or an unbroken
  // token), so the row needs an explicit minmax(0, 1fr) track and wrap-anywhere text.
  it('keeps a confirmation request inside the transcript column', () => {
    const { container } = render(
      <InteractionEventRow
        extensions={extensions}
        item={{
          request: confirmRequest(UNBROKEN_TOKEN),
          resolution: {
            type: 'agent_interaction_resolved',
            timestamp: 2,
            runId: 'run-1',
            interactionId: 'confirm-1',
            kind: 'confirm',
            status: 'errored',
            error: { message: `Failed: ${UNBROKEN_TOKEN}/error` },
          },
        }}
      />,
    )

    const section = rowSection(container)
    expect(section).toHaveClass('grid', 'grid-cols-1', 'min-w-0')
    expect(screen.getByText(UNBROKEN_TOKEN)).toHaveClass('wrap-anywhere')
    expect(screen.getByText(`Failed: ${UNBROKEN_TOKEN}/error`)).toHaveClass('wrap-anywhere')
  })

  it('keeps a multi-line request inside the transcript column', () => {
    const { container } = render(
      <InteractionEventRow
        extensions={extensions}
        item={{ request: confirmRequest(`npm install ${UNBROKEN_TOKEN}\n{"rule":"ask"}`) }}
      />,
    )

    expect(rowSection(container)).toHaveClass('grid', 'grid-cols-1', 'min-w-0')
    expect(screen.getByText(`npm install ${UNBROKEN_TOKEN}`)).toHaveClass('truncate')
  })

  it('wraps an unbroken token in a durable notification', () => {
    render(
      <InteractionEventRow
        extensions={extensions}
        item={{ request: notifyRequest('error', UNBROKEN_TOKEN) }}
      />,
    )

    expect(screen.getByText(UNBROKEN_TOKEN)).toHaveClass('wrap-anywhere')
  })
})
