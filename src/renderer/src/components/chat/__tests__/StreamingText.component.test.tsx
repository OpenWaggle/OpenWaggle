import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StreamingText } from '../StreamingText'

describe('StreamingText', () => {
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
})
