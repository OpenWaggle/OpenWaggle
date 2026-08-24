import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentInteractionComposerPrompt } from '../AgentInteractionComposerPrompt'

const SESSION_ID = SessionId('session-1')

function authorizationRequest(id = 'auth-1'): AgentLoopInteraction {
  return {
    interactionId: id,
    sessionId: SESSION_ID,
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Allow GitHub Issues to reach api.github.com?',
    message: 'Server: github-issues\nTool: List issues (list_issues)',
    purpose: 'authorization',
    scopeKey: {
      requester: 'github-issues',
      requesterId: 'github-issues-id',
      capability: 'mcp.tool-call',
      resource: 'list_issues',
    },
  }
}

function customRequest(id = 'custom-1'): AgentLoopInteraction {
  return {
    interactionId: id,
    sessionId: SESSION_ID,
    runId: 'run-1',
    kind: 'custom',
    source: 'pi-ui',
    createdAt: 1,
    customType: 'pi-tui-custom',
    renderer: { kind: 'pi-tui-custom', supported: false },
  }
}

/**
 * A composer that records whether anything about it was disturbed.
 *
 * Stands in for the real composer so the guarantee can be asserted structurally: an arriving request
 * must add a surface above the composer and change nothing about it.
 */
function ComposerUnderTest({ draft }: { readonly draft: string }) {
  return (
    <label>
      Message
      <textarea defaultValue={draft} placeholder="Ask anything · / skills & Waggle · @ files" />
    </label>
  )
}

describe('composer draft continuity', () => {
  it('leaves the draft, placeholder and enabled state untouched when a request arrives', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <>
        <AgentInteractionComposerPrompt interactions={[]} onRespond={onRespond} />
        <ComposerUnderTest draft="also check whether any are already fixed on main" />
      </>,
    )

    const input = screen.getByLabelText('Message')
    input.focus()
    expect(document.activeElement).toBe(input)

    rerender(
      <>
        <AgentInteractionComposerPrompt
          interactions={[authorizationRequest()]}
          onRespond={onRespond}
        />
        <ComposerUnderTest draft="also check whether any are already fixed on main" />
      </>,
    )

    // The ribbon is present.
    expect(screen.getByText('Needs decision')).toBeInTheDocument()

    // And the composer is exactly as it was.
    expect(input).toHaveValue('also check whether any are already fixed on main')
    expect(input).toHaveAttribute('placeholder', 'Ask anything · / skills & Waggle · @ files')
    expect(input).not.toBeDisabled()
    expect(document.activeElement).toBe(input)
  })

  it('does not move focus into the ribbon', () => {
    // T3 Code seizes the composer during an approval. We deliberately do not, so a sentence in
    // progress can be finished and sent before or after deciding.
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(
      <>
        <ComposerUnderTest draft="half a thought" />
        <AgentInteractionComposerPrompt
          interactions={[authorizationRequest()]}
          onRespond={onRespond}
        />
      </>,
    )

    const input = screen.getByLabelText('Message')
    input.focus()

    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Allow once' })).not.toHaveFocus()
  })
})

describe('AgentInteractionComposerPrompt', () => {
  it('renders the authorization ribbon with requester, question and target line', () => {
    render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('Needs decision')).toBeInTheDocument()
    expect(screen.getByText('github-issues')).toBeInTheDocument()
    expect(screen.getByText('Allow GitHub Issues to reach api.github.com?')).toBeInTheDocument()
    expect(screen.getByText('list_issues · Run a tool')).toBeInTheDocument()
  })

  it('offers continue without, a scope menu and allow once, with the primary last', () => {
    render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('button', { name: 'Continue without' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Allow…/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
  })

  it('keeps the payload out of the label and behind Details', () => {
    render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest()]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.queryByText(/Tool: List issues/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Details/ })).toBeInTheDocument()
  })

  it('counts every blocking request, including ones it does not render', () => {
    // The counter previously excluded custom interactions even though they occupy the same
    // composer area, so it understated how much was blocking the run.
    render(
      <AgentInteractionComposerPrompt
        interactions={[authorizationRequest(), customRequest(), authorizationRequest('auth-2')]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('renders nothing when no request is pending', () => {
    render(
      <AgentInteractionComposerPrompt
        interactions={[]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.queryByText('Needs decision')).not.toBeInTheDocument()
  })
})
