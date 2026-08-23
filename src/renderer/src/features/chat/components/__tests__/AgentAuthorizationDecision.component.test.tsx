import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentInteractionComposerPrompt } from '../AgentInteractionComposerPrompt'

const SESSION_ID = SessionId('session-1')

/**
 * These click the controls that hand out capabilities and assert the exact payload.
 *
 * Asserting only that the buttons render leaves every payload regression green: swapping accepted
 * between Allow and Continue without, dropping the scope so a standing approval silently degrades to
 * once-only, or emitting the project scope from the session choice so a one-session approval is
 * written to project config permanently. That last pair is how the scope was lost at the IPC
 * boundary without a single test failing.
 */
function authorizationRequest(): AgentLoopInteraction {
  return {
    interactionId: 'auth-1',
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
      capability: 'mcp.tool-call',
      resource: 'list_issues',
    },
  }
}

function questionRequest(): AgentLoopInteraction {
  return {
    interactionId: 'question-1',
    sessionId: SESSION_ID,
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Open the elicitation URL?',
    message: 'https://example.test/consent',
    purpose: 'external-navigation',
  }
}

function renderPrompt(interaction: AgentLoopInteraction) {
  const onRespond = vi.fn(() => Promise.resolve())
  render(
    <AgentInteractionComposerPrompt
      interactions={[interaction]}
      onRespond={onRespond}
      projectName="myproject"
    />,
  )
  return onRespond
}

describe('authorization decisions', () => {
  it('sends a bare acceptance for Allow once, with no scope', async () => {
    const onRespond = renderPrompt(authorizationRequest())

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ interactionId: 'auth-1' }), {
        accepted: true,
        kind: 'confirm',
      })
    })
  })

  it('sends a refusal for Continue without', async () => {
    const onRespond = renderPrompt(authorizationRequest())

    fireEvent.click(screen.getByRole('button', { name: /Continue without/ }))

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ interactionId: 'auth-1' }), {
        accepted: false,
        kind: 'confirm',
      })
    })
  })

  it.each([
    ['session', /this session/i],
    ['project', /Always allow/i],
  ])('carries the %s scope from the Allow menu', async (scope, label) => {
    const onRespond = renderPrompt(authorizationRequest())

    fireEvent.click(screen.getByRole('button', { name: /Allow…/ }))
    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith(expect.objectContaining({ interactionId: 'auth-1' }), {
        accepted: true,
        kind: 'confirm',
        scope,
      })
    })
  })

  it('names the requester and the destination in the standing-approval choice', async () => {
    renderPrompt(authorizationRequest())

    fireEvent.click(screen.getByRole('button', { name: /Allow…/ }))

    // The consent has to describe what is actually granted, or the user agrees to something else.
    const always = screen.getByRole('button', { name: /Always allow/i })
    expect(always).toHaveAccessibleName(expect.stringContaining('github-issues'))
    expect(always).toHaveAccessibleName(expect.stringContaining('myproject'))
  })

  it('closes the Allow menu on Escape instead of leaving a standing approval armed', async () => {
    renderPrompt(authorizationRequest())

    fireEvent.click(screen.getByRole('button', { name: /Allow…/ }))
    expect(screen.getByRole('button', { name: /Always allow/i })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: /Always allow/i }), { key: 'Escape' })

    expect(screen.queryByRole('button', { name: /Always allow/i })).not.toBeInTheDocument()
  })

  it('offers no scope choices for a request that is not an authorization', () => {
    renderPrompt(questionRequest())

    expect(screen.queryByRole('button', { name: /Allow…/ })).not.toBeInTheDocument()
  })
})
