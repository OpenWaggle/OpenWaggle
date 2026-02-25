import type { OAuthFlowStatus, SubscriptionAccountInfo } from '@shared/types/auth'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubscriptionAuthButton } from '../SubscriptionAuthButton'

describe('SubscriptionAuthButton', () => {
  const defaultProps = {
    provider: 'openrouter' as const,
    providerDisplayName: 'OpenRouter',
    accountInfo: null,
    oauthStatus: { type: 'idle' } as OAuthFlowStatus,
    onSignIn: vi.fn(),
    onDisconnect: vi.fn(),
  }

  it('renders sign-in button when not connected', () => {
    render(<SubscriptionAuthButton {...defaultProps} />)
    expect(screen.getByText('Sign in with OpenRouter')).toBeTruthy()
  })

  it('renders loading state during in-progress', () => {
    const status: OAuthFlowStatus = { type: 'in-progress', provider: 'openrouter' }
    render(<SubscriptionAuthButton {...defaultProps} oauthStatus={status} />)
    expect(screen.getByText('Signing in...')).toBeTruthy()
  })

  it('renders connected state with disconnect button', () => {
    const accountInfo: SubscriptionAccountInfo = {
      provider: 'openrouter',
      connected: true,
      label: 'Connected',
    }
    render(<SubscriptionAuthButton {...defaultProps} accountInfo={accountInfo} />)
    expect(screen.getByText('Connected via OpenRouter subscription')).toBeTruthy()
    expect(screen.getByText('Disconnect')).toBeTruthy()
  })

  it('renders error state with retry button', () => {
    const status: OAuthFlowStatus = {
      type: 'error',
      provider: 'openrouter',
      message: 'Connection failed',
    }
    render(<SubscriptionAuthButton {...defaultProps} oauthStatus={status} />)
    expect(screen.getByText('Connection failed')).toBeTruthy()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  it('calls onSignIn when sign-in button is clicked', () => {
    const onSignIn = vi.fn()
    render(<SubscriptionAuthButton {...defaultProps} onSignIn={onSignIn} />)
    fireEvent.click(screen.getByText('Sign in with OpenRouter'))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('calls onDisconnect when disconnect button is clicked', () => {
    const onDisconnect = vi.fn()
    const accountInfo: SubscriptionAccountInfo = {
      provider: 'openrouter',
      connected: true,
      label: 'Connected',
    }
    render(
      <SubscriptionAuthButton
        {...defaultProps}
        accountInfo={accountInfo}
        onDisconnect={onDisconnect}
      />,
    )
    fireEvent.click(screen.getByText('Disconnect'))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('shows ToS warning for OpenAI', () => {
    render(
      <SubscriptionAuthButton {...defaultProps} provider="openai" providerDisplayName="OpenAI" />,
    )
    expect(screen.getByText(/not officially supported/)).toBeTruthy()
  })

  it('shows ToS warning for Anthropic', () => {
    render(
      <SubscriptionAuthButton
        {...defaultProps}
        provider="anthropic"
        providerDisplayName="Anthropic"
      />,
    )
    expect(screen.getByText(/Terms of Service prohibit/)).toBeTruthy()
  })

  it('does not show ToS warning for OpenRouter', () => {
    render(<SubscriptionAuthButton {...defaultProps} />)
    expect(screen.queryByText(/Terms of Service/)).toBeNull()
  })

  it('shows disconnected reason when present', () => {
    const accountInfo: SubscriptionAccountInfo = {
      provider: 'openrouter',
      connected: false,
      label: 'Not connected',
      disconnectedReason: 'Session expired. Please sign in again.',
    }
    render(<SubscriptionAuthButton {...defaultProps} accountInfo={accountInfo} />)
    expect(screen.getByText('Session expired. Please sign in again.')).toBeTruthy()
  })

  it('disables sign-in button during in-progress', () => {
    const status: OAuthFlowStatus = { type: 'in-progress', provider: 'openrouter' }
    render(<SubscriptionAuthButton {...defaultProps} oauthStatus={status} />)
    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
