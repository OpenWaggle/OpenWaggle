import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyntaxHighlightRequest, SyntaxHighlightResult } from '@/shared/lib/syntax/protocol'
import { SourceView } from '../SourceView'

const syntaxMocks = vi.hoisted(() => ({
  highlight: vi.fn<(input: SyntaxHighlightRequest) => Promise<SyntaxHighlightResult>>(
    async ({ language, theme, lineRange }) => ({
      status: 'plain-text' as const,
      language,
      theme,
      lines: [],
      lineOffset: lineRange?.start ?? 0,
      elapsedMs: 0,
    }),
  ),
}))
const writeTextMock = vi.fn()

vi.mock('@/shared/hooks/useSyntaxTheme', () => ({
  useSyntaxTheme: () => ({ shikiTheme: 'dark-plus' }),
}))

vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: {
    highlight: syntaxMocks.highlight,
  },
}))

describe('SourceView virtualization', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    syntaxMocks.highlight.mockClear()
    writeTextMock.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  it('mounts only an overscanned window and replaces it as the user scrolls', async () => {
    let resolveViewportHighlight: (result: SyntaxHighlightResult) => void = () => undefined
    syntaxMocks.highlight
      .mockImplementationOnce(async ({ language, theme, lineRange }) => ({
        status: 'plain-text',
        language,
        theme,
        lines: [],
        lineOffset: lineRange?.start ?? 0,
        elapsedMs: 0,
      }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveViewportHighlight = resolve
          }),
      )
    const source = Array.from(
      { length: 10_000 },
      (_, index) => `source line ${String(index)}`,
    ).join('\n')
    render(<SourceView source={source} language="typescript" ariaLabel="Large source" />)

    const section = screen.getByRole('region', { name: 'Large source' })
    const scroller = section.querySelector('[data-source-scroller]')
    if (!(scroller instanceof HTMLElement)) throw new Error('Expected a source scroller.')
    expect(screen.getByText('source line 0')).toBeInTheDocument()
    expect(screen.queryByText('source line 500')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(syntaxMocks.highlight).toHaveBeenCalledWith(
        expect.objectContaining({ lineRange: { start: 0, end: expect.any(Number) } }),
      ),
    )
    await waitFor(() => expect(section).toHaveAttribute('data-syntax-status', 'plain-text'))

    scroller.scrollTop = 10_000
    fireEvent.scroll(scroller)
    await waitFor(() => expect(section).toHaveAttribute('data-syntax-status', 'loading'))
    expect(section.querySelector('[data-syntax-skeleton]')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('source line 500')).toBeInTheDocument())
    expect(screen.queryByText('source line 0')).not.toBeInTheDocument()
    expect(section.querySelectorAll('[style*="translateY"]').length).toBeLessThan(100)
    await waitFor(() =>
      expect(syntaxMocks.highlight).toHaveBeenLastCalledWith(
        expect.objectContaining({
          lineRange: expect.objectContaining({ start: expect.any(Number) }),
        }),
      ),
    )
    const lastInput: unknown = syntaxMocks.highlight.mock.calls.at(-1)?.[0]
    expect(lastInput).not.toMatchObject({ lineRange: { start: 0 } })
    await act(async () => {
      const lastRequest = syntaxMocks.highlight.mock.calls.at(-1)?.[0]
      resolveViewportHighlight({
        status: 'plain-text',
        language: 'typescript',
        theme: 'dark-plus',
        lines: [],
        lineOffset: lastRequest?.lineRange?.start ?? 0,
        elapsedMs: 0,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(section).toHaveAttribute('data-syntax-status', 'plain-text'))
    expect(section.querySelector('[data-syntax-skeleton]')).not.toBeInTheDocument()
  })

  it('keeps one source request alive across viewport changes and aborts it on unmount', async () => {
    const pending: Array<() => void> = []
    syntaxMocks.highlight.mockImplementationOnce(
      ({ language, theme, lineRange }) =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve({
              status: 'plain-text',
              language,
              theme,
              lines: [],
              lineOffset: lineRange?.start ?? 0,
              elapsedMs: 0,
            }),
          )
        }),
    )
    const view = render(
      <SourceView
        source={Array.from({ length: 1_000 }, (_, index) => `line ${String(index)}`).join('\n')}
        language="typescript"
        ariaLabel="Stable source"
      />,
    )
    const section = screen.getByRole('region', { name: 'Stable source' })
    const scroller = section.querySelector('[data-source-scroller]')
    if (!(scroller instanceof HTMLElement)) throw new Error('Expected a source scroller.')
    await waitFor(() => expect(syntaxMocks.highlight).toHaveBeenCalled())
    const firstSignal = syntaxMocks.highlight.mock.calls[0]?.[0].signal
    if (!firstSignal) throw new Error('Expected the source request to receive an abort signal.')

    scroller.scrollTop = 10_000
    fireEvent.scroll(scroller)
    await waitFor(() => expect(syntaxMocks.highlight).toHaveBeenCalledTimes(2))
    expect(firstSignal.aborted).toBe(false)

    view.unmount()
    expect(firstSignal.aborted).toBe(true)
    pending[0]?.()
  })

  it('clamps a stale viewport when a long source is replaced by a shorter source', async () => {
    const longSource = Array.from(
      { length: 1_000 },
      (_, index) => `long line ${String(index)}`,
    ).join('\n')
    const view = render(
      <SourceView source={longSource} language="typescript" ariaLabel="Replacing source" />,
    )
    const section = screen.getByRole('region', { name: 'Replacing source' })
    const scroller = section.querySelector('[data-source-scroller]')
    if (!(scroller instanceof HTMLElement)) throw new Error('Expected a source scroller.')

    scroller.scrollTop = 10_000
    fireEvent.scroll(scroller)
    await waitFor(() => expect(screen.getByText('long line 500')).toBeInTheDocument())

    expect(() =>
      view.rerender(
        <SourceView
          source={'short line 0\nshort line 1'}
          language="typescript"
          ariaLabel="Replacing source"
        />,
      ),
    ).not.toThrow()
    await waitFor(() => expect(section).toHaveTextContent('short line 1'))
  })

  it('copies the complete source even when the last lines are not mounted', () => {
    const source = Array.from({ length: 10_000 }, (_, index) => `copy line ${String(index)}`).join(
      '\n',
    )
    render(<SourceView source={source} language="typescript" ariaLabel="Copy source" />)

    expect(screen.queryByText('copy line 9999')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy complete source' }))
    expect(writeTextMock).toHaveBeenCalledWith(source)
  })

  it('retains compatible tokens while a theme replacement is pending', async () => {
    let resolveReplacement: (value: Awaited<ReturnType<typeof syntaxMocks.highlight>>) => void =
      () => undefined
    syntaxMocks.highlight
      .mockResolvedValueOnce({
        status: 'highlighted',
        language: 'typescript',
        theme: 'dark-plus',
        lines: [[{ content: 'const', color: 'var(--color-error)' }]],
        elapsedMs: 1,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReplacement = resolve
          }),
      )
    const view = render(
      <SourceView source="const" language="typescript" theme="dark-plus" ariaLabel="Themed" />,
    )
    await waitFor(() =>
      expect(screen.getByText('const')).toHaveStyle({ color: 'var(--color-error)' }),
    )

    view.rerender(
      <SourceView source="const" language="typescript" theme="light-plus" ariaLabel="Themed" />,
    )
    expect(screen.getByText('const')).toHaveStyle({ color: 'var(--color-error)' })

    resolveReplacement({
      status: 'highlighted',
      language: 'typescript',
      theme: 'light-plus',
      lines: [[{ content: 'const', color: 'var(--color-accent)' }]],
      elapsedMs: 1,
    })
    await waitFor(() =>
      expect(screen.getByText('const')).toHaveStyle({ color: 'var(--color-accent)' }),
    )
  })

  it('shows a highlighting skeleton on the first paint and swaps only when tokens are ready', async () => {
    let resolveHighlight: (result: SyntaxHighlightResult) => void = () => undefined
    syntaxMocks.highlight.mockImplementationOnce(
      ({ language, theme, lineRange }) =>
        new Promise((resolve) => {
          resolveHighlight = resolve
          expect(lineRange).toBeDefined()
          expect(language).toBe('typescript')
          expect(theme).toBe('dark-plus')
        }),
    )

    render(
      <SourceView
        source={'const value = 42\nexport { value }'}
        language="typescript"
        ariaLabel="Pending source"
      />,
    )

    const section = screen.getByRole('region', { name: 'Pending source' })
    expect(section).toHaveAttribute('data-syntax-status', 'loading')
    expect(screen.getAllByText('Highlighting source…')).toHaveLength(2)
    expect(section.querySelector('[data-syntax-skeleton]')).toBeInTheDocument()
    expect(screen.getByText('const value = 42')).toHaveClass('sr-only')

    await act(async () => {
      resolveHighlight({
        status: 'highlighted',
        language: 'typescript',
        theme: 'dark-plus',
        lines: [
          [{ content: 'const value = 42', color: 'var(--color-accent)' }],
          [{ content: 'export { value }', color: 'var(--color-accent)' }],
        ],
        elapsedMs: 300,
      })
      await Promise.resolve()
    })

    expect(section).toHaveAttribute('data-syntax-status', 'highlighted')
    expect(screen.queryByText('Highlighting source…')).not.toBeInTheDocument()
    expect(section.querySelector('[data-syntax-skeleton]')).not.toBeInTheDocument()
  })
})
