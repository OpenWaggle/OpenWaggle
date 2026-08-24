import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { DEFAULT_SHORTCUT_BINDINGS, SHORTCUT_COMMANDS } from '@shared/types/shortcuts'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingRequestFocusMemoryForTests,
  focusPendingRequest,
} from '../../lib/pending-request-focus'
import { AgentInteractionComposerPrompt } from '../AgentInteractionComposerPrompt'

const SESSION_ID = SessionId('session-1')

function baseRequest(kind: 'select' | 'input' | 'editor') {
  return {
    interactionId: `${kind}-1`,
    sessionId: SESSION_ID,
    runId: 'run-1',
    source: 'pi-ui',
    createdAt: 1,
  } as const
}

function selectRequest(): AgentLoopInteraction {
  return {
    ...baseRequest('select'),
    kind: 'select',
    title: 'Which branch should I use?',
    choices: ['main', 'develop'],
  }
}

function inputRequest(): AgentLoopInteraction {
  return { ...baseRequest('input'), kind: 'input', title: 'Name the new branch' }
}

function editorRequest(): AgentLoopInteraction {
  return { ...baseRequest('editor'), kind: 'editor', title: 'Edit the commit message' }
}

function authorizationRequest(): AgentLoopInteraction {
  return {
    interactionId: 'auth-1',
    sessionId: SESSION_ID,
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Allow GitHub Issues to reach api.github.com?',
    message: 'Server: github-issues',
    purpose: 'authorization',
    scopeKey: {
      requester: 'github-issues',
      requesterId: 'github-issues-id',
      capability: 'mcp.tool-call',
      resource: 'list_issues',
    },
  }
}

const onRespond = vi.fn().mockResolvedValue(undefined)

describe('request controls have accessible names', () => {
  it('names the select and both of its actions', () => {
    render(
      <AgentInteractionComposerPrompt interactions={[selectRequest()]} onRespond={onRespond} />,
    )

    expect(screen.getByRole('combobox', { name: 'Which branch should I use?' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select for Which branch should I use?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cancel Which branch should I use?' }),
    ).toBeInTheDocument()
  })

  it('names the text input and both of its actions', () => {
    render(<AgentInteractionComposerPrompt interactions={[inputRequest()]} onRespond={onRespond} />)

    expect(screen.getByRole('textbox', { name: 'Name the new branch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Name the new branch' })).toBeInTheDocument()
  })

  it('names the editor and both of its actions', () => {
    render(
      <AgentInteractionComposerPrompt interactions={[editorRequest()]} onRespond={onRespond} />,
    )

    expect(screen.getByRole('textbox', { name: 'Edit the commit message' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit Edit the commit message' }),
    ).toBeInTheDocument()
  })

  it('announces the request from a region that was already present', () => {
    // The announcer has to exist before the request arrives. A live region mounted in the same commit
    // as its text is not announced by VoiceOver, so asserting `aria-live` on the ribbon itself was
    // exactly the assertion that stayed green while nothing was ever announced.
    const { container, rerender } = render(
      <AgentInteractionComposerPrompt interactions={[]} onRespond={onRespond} />,
    )

    const announcer = container.querySelector('[role="status"]')
    expect(announcer).toHaveAttribute('aria-live', 'polite')
    expect(announcer).toHaveTextContent('')

    rerender(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={onRespond}
      />,
    )

    // Same node, new content: that is what produces an announcement.
    expect(container.querySelector('[role="status"]')).toBe(announcer)
    expect(announcer).toHaveTextContent('Allow GitHub Issues to reach api.github.com?')

    // Polite, never assertive: assertive would cut across whatever the user is dictating or reading.
    expect(announcer).not.toHaveAttribute('aria-live', 'assertive')
  })
})

describe('reaching a pending request from the keyboard', () => {
  beforeEach(() => {
    clearPendingRequestFocusMemoryForTests()
  })

  it('is remappable through the shortcut registry rather than hard-coded', () => {
    expect(SHORTCUT_COMMANDS).toContain('request.focus')
    expect(DEFAULT_SHORTCUT_BINDINGS['request.focus']).toEqual({ key: 'A', mod: true, shift: true })
  })

  it('binds exactly one request command, and it only moves focus', () => {
    // Asserting that no command is *named* like a grant is a spelling check: `request.confirm` or
    // `ribbon.primary` would pass it while violating the invariant outright. What matters is that the
    // only request-scoped command that exists is the one that moves focus.
    const requestCommands = SHORTCUT_COMMANDS.filter((command) => command.startsWith('request.'))

    expect(requestCommands).toEqual(['request.focus'])
  })

  it('reaches the request without answering it', async () => {
    const onRespond = vi.fn(() => Promise.resolve())
    render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={onRespond}
        projectName="myproject"
      />,
    )

    // The behavioural half of the invariant: the shortcut's callback lands on a control and submits
    // nothing. A binding that answered the request would fail here regardless of its name.
    expect(focusPendingRequest()).toBe(true)
    expect(document.activeElement?.tagName).toBe('BUTTON')
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('moves focus to the request and returns it on Escape, without answering anything', () => {
    render(
      <>
        <label>
          Message
          <textarea defaultValue="half a thought" />
        </label>
        <AgentInteractionComposerPrompt
          interactions={[authorizationRequest()]}
          onRespond={onRespond}
        />
      </>,
    )

    const composer = screen.getByLabelText('Message')
    composer.focus()
    expect(document.activeElement).toBe(composer)

    expect(focusPendingRequest()).toBe(true)
    expect(document.activeElement).not.toBe(composer)
    expect(document.activeElement).toBeInstanceOf(HTMLButtonElement)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Continue without' }), { key: 'Escape' })

    expect(document.activeElement).toBe(composer)
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('reports that nothing was focused when no request is waiting', () => {
    // So the keystroke can fall through to other handlers rather than being swallowed.
    render(<AgentInteractionComposerPrompt interactions={[]} onRespond={onRespond} />)

    expect(focusPendingRequest()).toBe(false)
  })
})
