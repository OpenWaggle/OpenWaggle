import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingText } from '../StreamingText'

const syntaxMocks = vi.hoisted(() => ({
  highlight: vi.fn(async (input?: { source: string; language: string; theme: string }) => ({
    status: 'plain-text' as const,
    language: input?.language ?? 'text',
    theme: input?.theme ?? 'dark-plus',
    lines: (input?.source ?? '').split('\n').map((line: string) => [{ content: line }]),
    elapsedMs: 0,
  })),
}))

vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: { highlight: syntaxMocks.highlight },
}))

describe('StreamingText Session links', () => {
  beforeEach(() => syntaxMocks.highlight.mockClear())

  it('renders a Session link as a link and drops any other openwaggle URL', () => {
    render(
      <StreamingText
        text={
          '[worker](openwaggle://sessions/session-1) <openwaggle://sessions/session-2> [app](openwaggle://app/index.html) [query](openwaggle://sessions/session-3?prompt=run)'
        }
      />,
    )

    const worker = screen.getByRole('link', { name: 'worker' })
    expect(worker).toHaveAttribute('href', 'openwaggle://sessions/session-1')
    expect(worker).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'openwaggle://sessions/session-2' })).toHaveAttribute(
      'href',
      'openwaggle://sessions/session-2',
    )
    expect(screen.queryByRole('link', { name: 'app' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'query' })).toBeNull()
    expect(screen.getByText('app')).toBeInTheDocument()
  })

  it('links a Session link written as plain text, but not code or a longer URL', () => {
    render(
      <StreamingText
        text={
          'See openwaggle://sessions/session-1. Not `openwaggle://sessions/session-2` or openwaggle://sessions/session-3/items.'
        }
      />,
    )

    expect(screen.getByRole('link', { name: 'openwaggle://sessions/session-1' })).toHaveAttribute(
      'href',
      'openwaggle://sessions/session-1',
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('openwaggle://sessions/session-2')).toBeInTheDocument()
  })

  it('links a Session link in a completed block while the rest still streams', () => {
    render(
      <StreamingText
        isStreaming
        text={
          'Done: openwaggle://sessions/session-1 and [app](openwaggle://app/index.html).\n\nStill writing openwaggle://sessions/sess'
        }
      />,
    )

    expect(screen.getByRole('link', { name: 'openwaggle://sessions/session-1' })).toHaveAttribute(
      'href',
      'openwaggle://sessions/session-1',
    )
    // The streaming block holds half an identity, so it is not a link yet.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'app' })).toBeNull()
  })
})
