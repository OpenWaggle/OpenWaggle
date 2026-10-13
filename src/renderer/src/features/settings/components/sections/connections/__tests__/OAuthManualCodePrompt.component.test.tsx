import type { OAuthFlowStatus } from '@shared/types/auth'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OAuthManualCodePrompt } from '../OAuthManualCodePrompt'

const COPILOT_PROMPT = 'GitHub Enterprise URL/domain (blank for github.com)'

function renderPrompt(oauthStatus: OAuthFlowStatus) {
  const submitAuthCode = vi.fn(async () => undefined)
  render(
    <OAuthManualCodePrompt
      provider="github-copilot"
      oauthStatus={oauthStatus}
      submitAuthCode={submitAuthCode}
    />,
  )
  return submitAuthCode
}

describe('OAuthManualCodePrompt', () => {
  it("shows GitHub Copilot's question and lets a blank answer through for github.com", () => {
    const submitAuthCode = renderPrompt({
      type: 'awaiting-code',
      provider: 'github-copilot',
      prompt: { message: COPILOT_PROMPT, placeholder: 'company.ghe.com', allowEmpty: true },
    })

    expect(screen.getByText(COPILOT_PROMPT)).toBeVisible()
    expect(screen.getByRole('textbox', { name: COPILOT_PROMPT })).toHaveAttribute(
      'placeholder',
      'company.ghe.com',
    )
    expect(screen.queryByText(/Waiting for the browser callback/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(submitAuthCode).toHaveBeenCalledWith('github-copilot', '')
  })

  it('does not send a blank code or secret', () => {
    const submitAuthCode = renderPrompt({
      type: 'awaiting-code',
      provider: 'github-copilot',
      prompt: { message: 'Paste your token', secret: true },
    })

    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Paste your token'), { key: 'Enter' })
    expect(submitAuthCode).not.toHaveBeenCalled()
  })

  it("shows Radius's instructions and its sign-in link while the browser finishes signing in", () => {
    renderPrompt({
      type: 'awaiting-code',
      provider: 'radius',
      authUrl: 'https://radius.test/oauth/authorize',
      instructions: 'Continue in your browser.',
    })

    expect(screen.getByText('Continue in your browser.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy sign-in link' })).toBeInTheDocument()
    // Nothing was asked, so there is nothing to paste.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says it waits for the browser when a sign-in link has no instructions', () => {
    renderPrompt({
      type: 'awaiting-code',
      provider: 'openai-codex',
      authUrl: 'https://example.test/authorize',
    })

    expect(screen.getByText(/Waiting for the browser/u)).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
