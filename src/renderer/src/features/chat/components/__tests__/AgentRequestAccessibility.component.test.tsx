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

  it('announces politely rather than interrupting', () => {
    // Assertive would cut across whatever the user is dictating or reading, which is the audio
    // equivalent of stealing their caret.
    const { container } = render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={onRespond}
      />,
    )

    const ribbon = container.querySelector('[data-request-ribbon="true"]')
    expect(ribbon).toHaveAttribute('aria-live', 'polite')
    expect(ribbon).not.toHaveAttribute('aria-live', 'assertive')
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

  it('binds no key to a grant action', () => {
    // A mistyped chord must not be able to grant a capability, so the shortcut reaches the request
    // and never answers it.
    const grantLike = SHORTCUT_COMMANDS.filter((command) =>
      /allow|grant|approve|authorize/i.test(command),
    )

    expect(grantLike).toEqual([])
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
