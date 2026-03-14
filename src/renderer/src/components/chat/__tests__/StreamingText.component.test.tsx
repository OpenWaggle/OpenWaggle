import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingText } from '../StreamingText'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16

describe('StreamingText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), REQUEST_ANIMATION_FRAME_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders allowed markdown links with safe attributes', () => {
    render(
      <StreamingText
        text={
          '[site](https://example.com) [email](mailto:test@example.com) [phone](tel:+123456789)'
        }
      />,
    )

    const siteLink = screen.getByRole('link', { name: 'site' })
    const emailLink = screen.getByRole('link', { name: 'email' })
    const phoneLink = screen.getByRole('link', { name: 'phone' })

    expect(siteLink).toHaveAttribute('href', 'https://example.com')
    expect(emailLink).toHaveAttribute('href', 'mailto:test@example.com')
    expect(phoneLink).toHaveAttribute('href', 'tel:+123456789')
    expect(siteLink).toHaveAttribute('target', '_blank')
    expect(siteLink).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  })

  it('blocks javascript and data URL links from rendering as anchors', () => {
    render(<StreamingText text="[bad](javascript:alert(1)) [bad2](data:text/html,boom)" />)

    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'bad2' })).toBeNull()
    expect(screen.getByText('bad')).toBeInTheDocument()
    expect(screen.getByText('bad2')).toBeInTheDocument()
  })

  it('does not render raw HTML payloads as executable DOM nodes', () => {
    const { container } = render(<StreamingText text={'<img src=x onerror=alert(1) />'} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('preserves syntax highlighting classes for fenced code blocks', () => {
    const { container } = render(<StreamingText text={'```ts\nconst value = 1\n```'} />)

    const code = container.querySelector('code')
    const highlightedToken = container.querySelector('span[class*="hljs-"]')
    expect(code).toBeTruthy()
    expect(code?.className).toContain('language-ts')
    expect(highlightedToken).toBeTruthy()
  })

  it('renders text immediately when streaming is false', () => {
    const { rerender } = render(<StreamingText text="first" isStreaming={false} />)

    expect(screen.getByText('first')).toBeInTheDocument()

    rerender(<StreamingText text="second" isStreaming={false} />)

    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('batches rapid text updates until the next animation frame while streaming', async () => {
    const { rerender } = render(<StreamingText text="alpha" isStreaming />)

    expect(screen.getByText('alpha')).toBeInTheDocument()

    rerender(<StreamingText text="beta" isStreaming />)
    rerender(<StreamingText text="gamma" isStreaming />)
    rerender(<StreamingText text="omega" isStreaming />)

    expect(screen.queryByText('omega')).toBeNull()
    expect(screen.getByText('alpha')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(screen.getByText('omega')).toBeInTheDocument()
    expect(screen.queryByText('beta')).toBeNull()
    expect(screen.queryByText('gamma')).toBeNull()
  })

  it('flushes the latest text immediately when streaming ends', () => {
    const { rerender } = render(<StreamingText text="draft" isStreaming />)

    rerender(<StreamingText text="final" isStreaming />)

    expect(screen.queryByText('final')).toBeNull()

    rerender(<StreamingText text="final" isStreaming={false} />)

    expect(screen.getByText('final')).toBeInTheDocument()
  })
})
