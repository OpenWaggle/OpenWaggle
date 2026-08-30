import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    syntaxMocks.highlight.mockClear()
    writeTextMock.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  it('mounts only an overscanned window and replaces it as the user scrolls', async () => {
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

    scroller.scrollTop = 10_000
    fireEvent.scroll(scroller)
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
})
