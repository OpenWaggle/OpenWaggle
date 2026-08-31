import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
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

describe('StreamingText', () => {
  beforeEach(() => syntaxMocks.highlight.mockClear())
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

  it('preserves language metadata and a safe fallback for fenced code blocks', () => {
    const { container } = render(<StreamingText text={'```ts\nconst value = 1\n```'} />)

    const code = container.querySelector('code')
    expect(code).toBeTruthy()
    expect(code?.className).toContain('language-ts')
    expect(container.querySelector('[data-syntax-status="plain-text"]')).toBeTruthy()
    expect(container).toHaveTextContent('const value = 1')
  })

  it('renders text immediately when streaming is false', () => {
    const { rerender } = render(<StreamingText text="first" isStreaming={false} />)

    expect(screen.getByText('first')).toBeInTheDocument()

    rerender(<StreamingText text="second" isStreaming={false} />)

    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('renders text immediately on each update while streaming', () => {
    const { rerender } = render(<StreamingText text="alpha" isStreaming />)

    expect(screen.getByText('alpha')).toBeInTheDocument()

    rerender(<StreamingText text="omega" isStreaming />)

    expect(screen.getByText('omega')).toBeInTheDocument()
  })

  it('keeps a byte-zero streaming fence plain until the response completes', async () => {
    const source = '```objective-c\nNSString *value = @"OpenWaggle";\n```'
    const { rerender } = render(<StreamingText text={source} isStreaming />)

    expect(syntaxMocks.highlight).not.toHaveBeenCalled()
    expect(screen.getByText('objective-c')).toBeInTheDocument()

    rerender(<StreamingText text={source} isStreaming={false} />)
    await vi.waitFor(() => expect(syntaxMocks.highlight).toHaveBeenCalledTimes(1))
    expect(syntaxMocks.highlight).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'objective-c' }),
    )
  })

  it('renders text immediately when streaming ends', () => {
    const { rerender } = render(<StreamingText text="draft" isStreaming />)

    rerender(<StreamingText text="final" isStreaming />)

    expect(screen.getByText('final')).toBeInTheDocument()

    rerender(<StreamingText text="final" isStreaming={false} />)

    expect(screen.getByText('final')).toBeInTheDocument()
  })

  it('shows active worktree paths relative to the project root', () => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-a'
    render(
      <ChatDisplayPathProvider
        projectPath="/Users/diego/Projects/OpenWaggle"
        worktreePath={worktreePath}
      >
        <StreamingText text={`Read ${worktreePath}/.agents/skills/grill-me/SKILL.md`} />
      </ChatDisplayPathProvider>,
    )

    expect(screen.getByText('Read .agents/skills/grill-me/SKILL.md')).toBeInTheDocument()
    expect(screen.queryByText(/\.openwaggle\/worktrees/)).toBeNull()
  })

  it('shortens prose paths without rewriting inline or fenced code', () => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-a'
    const sourcePath = `${worktreePath}/src/main.ts`
    const sourceLine = `const source = '${sourcePath}'`
    const { container } = render(
      <ChatDisplayPathProvider
        projectPath="/Users/diego/Projects/OpenWaggle"
        worktreePath={worktreePath}
      >
        <StreamingText
          text={[
            `Read ${sourcePath}`,
            '',
            `Inline: \`${sourcePath}\``,
            '',
            '```ts',
            sourceLine,
            '```',
          ].join('\n')}
        />
      </ChatDisplayPathProvider>,
    )

    expect(screen.getByText('Read src/main.ts')).toBeInTheDocument()
    const code = [...container.querySelectorAll('code')]
    expect(code.some((node) => node.textContent === sourcePath)).toBe(true)
    expect(code.some((node) => node.textContent?.includes(sourceLine))).toBe(true)
  })

  it.each([
    ['four-space', '    '],
    ['tab', '\t'],
  ])('shortens prose without rewriting %s-indented code', (_label, indentation) => {
    const worktreePath = '/Users/diego/.openwaggle/worktrees/OpenWaggle/session-a'
    const sourcePath = `${worktreePath}/src/main.ts`
    const sourceLine = `const source = '${sourcePath}'`
    const { container } = render(
      <ChatDisplayPathProvider
        projectPath="/Users/diego/Projects/OpenWaggle"
        worktreePath={worktreePath}
      >
        <StreamingText text={`Read ${sourcePath}\n\n${indentation}${sourceLine}`} />
      </ChatDisplayPathProvider>,
    )

    expect(screen.getByText('Read src/main.ts')).toBeInTheDocument()
    expect(
      [...container.querySelectorAll('code')].some((node) =>
        node.textContent?.includes(sourceLine),
      ),
    ).toBe(true)
  })
})
