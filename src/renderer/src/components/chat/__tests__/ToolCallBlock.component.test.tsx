import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

const mockCopyToClipboard = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  api: {
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}))

describe('ToolCallBlock', () => {
  beforeEach(() => {
    mockCopyToClipboard.mockReset()
  })

  it('renders natural action text for known tool', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"src/main.ts"}'
        state="input-complete"
        result={{ content: 'file content', state: 'success' }}
      />,
    )
    expect(screen.getByText('Read src/main.ts')).toBeInTheDocument()
  })

  it('renders tool name as fallback for unknown tool', () => {
    render(
      <ToolCallBlock
        name="customTool"
        args="{}"
        state="input-complete"
        result={{ content: '', state: 'success' }}
      />,
    )
    expect(screen.getByText('customTool')).toBeInTheDocument()
  })

  it('shows running action text with ellipsis when running', () => {
    render(<ToolCallBlock name="read" args='{"path":"src/index.ts"}' state="running" isStreaming />)
    expect(screen.getByText('Reading src/index.ts...')).toBeInTheDocument()
  })

  it('shows spinner when tool is running', () => {
    const { container } = render(
      <ToolCallBlock name="bash" args='{"command":"ls"}' state="running" isStreaming />,
    )
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('does not render running state for historical unresolved tool calls', () => {
    const { container } = render(
      <ToolCallBlock name="write" args='{"path":"out.txt"}' state="input-complete" />,
    )

    expect(screen.getByText('Requested write out.txt')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('shows check icon when completed successfully', () => {
    const { container } = render(
      <ToolCallBlock
        name="read"
        args='{"path":"file.ts"}'
        state="input-complete"
        result={{ content: 'file content', state: 'success' }}
      />,
    )
    // Check icon is rendered as an SVG — look for the completed action text style
    expect(screen.getByText('Read file.ts')).toBeInTheDocument()
    // No spinner should be present
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('shows error text when result has error', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"missing.ts"}'
        state="input-complete"
        result={{ content: '', state: 'error', error: 'File not found' }}
      />,
    )
    expect(screen.getByText('Failed read missing.ts')).toBeInTheDocument()
  })

  it('renders completed state once a concrete result exists', () => {
    render(
      <ToolCallBlock
        name="write"
        args='{"path":"docs/SUMMARY.md"}'
        state="input-complete"
        result={{
          content: '{"kind":"json","data":{"message":"File written: docs/SUMMARY.md"}}',
          state: 'output-available',
        }}
      />,
    )

    expect(screen.getByText('Wrote docs/SUMMARY.md')).toBeInTheDocument()
  })

  it('shows bash with backtick-wrapped verb', () => {
    render(
      <ToolCallBlock
        name="bash"
        args='{"command":"pnpm test"}'
        state="input-complete"
        result={{ content: '"passed"', state: 'success' }}
      />,
    )
    expect(screen.getByText('Ran `pnpm test`')).toBeInTheDocument()
  })

  it('expands to show arguments on click', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"src/main.ts"}'
        state="input-complete"
        result={{ content: 'file content', state: 'success' }}
      />,
    )
    // Arguments not visible initially
    expect(screen.queryByText('Arguments')).toBeNull()

    // Click header to expand
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Arguments')).toBeInTheDocument()
  })

  it('shows result content when expanded and completed', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"file.ts"}'
        state="input-complete"
        result={{ content: '"hello world"', state: 'success' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Result')).toBeInTheDocument()
  })

  it('shows command with $ prefix for bash args when expanded', () => {
    render(
      <ToolCallBlock
        name="bash"
        args='{"command":"npm test"}'
        state="input-complete"
        result={{ content: '"passed"', state: 'success' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('$')).toBeInTheDocument()
  })

  it('shows error content when expanded and errored', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"missing.ts"}'
        state="input-complete"
        result={{ content: '', state: 'error', error: 'ENOENT' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('ENOENT')).toBeInTheDocument()
  })

  it('handles malformed JSON args gracefully', () => {
    render(<ToolCallBlock name="read" args="not-json" state="input-complete" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('not-json')).toBeInTheDocument()
  })

  it('renders Pi structured text results without exposing raw JSON', () => {
    render(
      <ToolCallBlock
        name="bash"
        args='{"command":"pnpm test"}'
        state="complete"
        result={{
          content: {
            content: [{ type: 'text', text: 'tests passed' }],
            details: { fullOutputPath: null },
          },
          state: 'complete',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('tests passed')).toBeInTheDocument()
    expect(screen.queryByText(/fullOutputPath/)).toBeNull()
  })

  it('renders Pi edit diff details inline for small diffs', () => {
    render(
      <ToolCallBlock
        name="edit"
        args='{"path":"src/app.ts"}'
        state="complete"
        result={{
          content: {
            content: [{ type: 'text', text: 'Successfully replaced 1 block(s).' }],
            details: {
              diff: '@@ -1 +1 @@\n-old line\n+new line',
              firstChangedLine: 1,
            },
          },
          state: 'complete',
        }}
      />,
    )

    expect(screen.getByText('Edited src/app.ts')).toBeInTheDocument()
    expect(screen.getAllByText('+1')).toHaveLength(2)
    expect(screen.getAllByText('-1')).toHaveLength(2)
    expect(screen.getByText('+new line')).toBeInTheDocument()
  })

  it('syntax highlights read tool file content using the existing Shiki pipeline', async () => {
    const { container } = render(
      <ToolCallBlock
        name="read"
        args='{"path":"src/example.ts"}'
        state="complete"
        result={{ content: 'const value = 1', state: 'complete' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read src\/example\.ts/ }))

    expect(container.querySelector('code.language-typescript')).toBeTruthy()
    await waitFor(() => {
      expect(container.querySelector('code span[style]')).toBeTruthy()
    })
  })

  it('uses plain rendering for very large file previews to keep expansion responsive', () => {
    const largeContent = `${'line\n'.repeat(1_201)}`
    const { container } = render(
      <ToolCallBlock
        name="read"
        args='{"path":"src/example.ts"}'
        state="complete"
        result={{ content: largeContent, state: 'complete' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read src\/example\.ts/ }))

    expect(
      screen.getByText(
        'Large file preview shown without syntax highlighting to keep the UI responsive.',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('code.language-typescript')).toBeNull()
  })

  it('copies path values from expanded tool details', () => {
    render(
      <ToolCallBlock
        name="read"
        args='{"path":"src/main.ts"}'
        state="complete"
        result={{ content: 'file content', state: 'complete' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read src\/main\.ts/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))

    expect(mockCopyToClipboard).toHaveBeenCalledWith('src/main.ts')
  })
})
