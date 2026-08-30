import type {
  OpenWaggleExtensionSyntaxHighlightResult,
  OpenWaggleExtensionSyntaxSdk,
} from '@openwaggle/extension-sdk'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourceView, SyntaxBlock } from '../index'

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
    expect(highlight).toHaveBeenCalledWith({
      source: 'const x = 1',
      language: 'typescript',
      path: undefined,
      priority: 'visible',
    })
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
    rendered.rerender(<SyntaxBlock syntax={syntax} source="second" language="typescript" />)
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

  it('keeps large virtualized sources plain without transferring them to the host', () => {
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
    expect(container.querySelectorAll('[data-ow-source-row]').length).toBeLessThan(100)
  })
})
