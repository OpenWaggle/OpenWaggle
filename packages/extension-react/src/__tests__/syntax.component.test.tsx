import type {
  OpenWaggleExtensionSyntaxHighlightResult,
  OpenWaggleExtensionSyntaxSdk,
} from '@openwaggle/extension-sdk'
import { createPlainExtensionSyntaxResult } from '@openwaggle/extension-sdk'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourceView, SyntaxBlock } from '../index'

vi.mock('@openwaggle/extension-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openwaggle/extension-sdk')>()
  return {
    ...actual,
    createPlainExtensionSyntaxResult: vi.fn(actual.createPlainExtensionSyntaxResult),
  }
})

describe('@openwaggle/extension-react syntax primitives', () => {
  it('requests host syntax and renders token styles with optional line numbers', async () => {
    const highlight = vi.fn<OpenWaggleExtensionSyntaxSdk['highlight']>(async () => ({
      status: 'highlighted',
      language: 'typescript',
      foreground: '#eeeeee',
      background: '#111111',
      lines: [[{ content: 'const', color: '#ff0000', fontStyle: 2 }, { content: ' x = 1' }]],
    }))
    const syntax: OpenWaggleExtensionSyntaxSdk = { highlight }
    render(
      <SourceView
        syntax={syntax}
        source="const x = 1"
        language="typescript"
        ariaLabel="Extension source"
      />,
    )

    const section = screen.getByLabelText('Extension source')
    const source = section.querySelector('pre')
    if (!source) throw new Error('Expected syntax source block.')
    await waitFor(() => expect(source).toHaveAttribute('data-ow-syntax-status', 'highlighted'))
    expect(source).toHaveStyle({ color: '#eeeeee', backgroundColor: '#111111' })
    expect(screen.getByText('const')).toHaveStyle({ color: '#ff0000', fontWeight: '600' })
    expect(source.querySelector('.ow-syntax-line-number')).toHaveTextContent('1')
    expect(highlight).toHaveBeenCalledWith(
      {
        source: 'const x = 1',
        language: 'typescript',
        path: undefined,
        priority: 'visible',
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('does not let an obsolete async result replace newer source', async () => {
    let resolveFirst: (result: OpenWaggleExtensionSyntaxHighlightResult) => void = () => undefined
    const first = new Promise<OpenWaggleExtensionSyntaxHighlightResult>((resolve) => {
      resolveFirst = resolve
    })
    const highlight = vi.fn<OpenWaggleExtensionSyntaxSdk['highlight']>((input) =>
      input.source === 'first'
        ? first
        : Promise.resolve({
            status: 'highlighted',
            language: 'typescript',
            lines: [[{ content: 'second highlighted' }]],
          }),
    )
    const syntax: OpenWaggleExtensionSyntaxSdk = { highlight }
    const rendered = render(<SyntaxBlock syntax={syntax} source="first" language="typescript" />)
    const firstSignal = highlight.mock.calls[0]?.[1]?.signal
    if (!firstSignal) throw new Error('Expected a cancellable syntax request.')
    rendered.rerender(<SyntaxBlock syntax={syntax} source="second" language="typescript" />)
    expect(firstSignal.aborted).toBe(true)
    await screen.findByText('second highlighted')
    resolveFirst({
      status: 'highlighted',
      language: 'typescript',
      lines: [[{ content: 'stale first' }]],
    })

    await Promise.resolve()
    expect(screen.queryByText('stale first')).not.toBeInTheDocument()
    expect(screen.getByText('second highlighted')).toBeInTheDocument()
  })

  it('clamps its virtual range when a long source is replaced by a shorter source', async () => {
    const highlight = vi.fn<OpenWaggleExtensionSyntaxSdk['highlight']>(async (input) =>
      createPlainExtensionSyntaxResult(input),
    )
    const syntax: OpenWaggleExtensionSyntaxSdk = { highlight }
    const longSource = Array.from({ length: 5_000 }, (_, index) => `long ${String(index)}`).join(
      '\n',
    )
    const rendered = render(
      <SourceView
        syntax={syntax}
        source={longSource}
        language="typescript"
        ariaLabel="Paged source"
      />,
    )
    const source = screen.getByLabelText('Paged source').querySelector('pre')
    if (!source) throw new Error('Expected syntax source block.')

    source.scrollTop = 10_000
    fireEvent.scroll(source)
    await screen.findByText('long 500')

    expect(() =>
      rendered.rerender(
        <SourceView
          syntax={syntax}
          source={'short 0\nshort 1'}
          language="typescript"
          ariaLabel="Paged source"
        />,
      ),
    ).not.toThrow()
    await waitFor(() => expect(source).toHaveTextContent('short 1'))
  })

  it('keeps large virtualized sources plain without transferring them to the host', () => {
    vi.mocked(createPlainExtensionSyntaxResult).mockClear()
    const highlight = vi.fn<OpenWaggleExtensionSyntaxSdk['highlight']>()
    const syntax: OpenWaggleExtensionSyntaxSdk = { highlight }
    const source = Array.from(
      { length: 5_000 },
      (_, index) => `const value${String(index)} = ${String(index)}`,
    ).join('\n')
    const { container } = render(
      <SourceView syntax={syntax} source={source} language="typescript" ariaLabel="Large source" />,
    )

    expect(highlight).not.toHaveBeenCalled()
    expect(createPlainExtensionSyntaxResult).not.toHaveBeenCalled()
    const rows = container.querySelectorAll('[data-ow-source-row]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(100)
    expect(rows[0]).toHaveTextContent('const value0 = 0')
  })
})
