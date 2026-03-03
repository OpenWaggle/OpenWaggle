import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

describe('ToolCallBlock', () => {
  beforeEach(() => {
    // No store setup needed — ToolCallBlock is self-contained
  })

  it('renders natural action text for known tool', () => {
    render(
      <ToolCallBlock
        name="readFile"
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
    render(
      <ToolCallBlock name="readFile" args='{"path":"src/index.ts"}' state="running" isStreaming />,
    )
    expect(screen.getByText('Reading src/index.ts...')).toBeInTheDocument()
  })

  it('shows spinner when tool is running', () => {
    const { container } = render(
      <ToolCallBlock name="runCommand" args='{"command":"ls"}' state="running" isStreaming />,
    )
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('does not render running state for historical unresolved tool calls', () => {
    const { container } = render(
      <ToolCallBlock name="writeFile" args='{"path":"out.txt"}' state="input-complete" />,
    )

    expect(screen.getByText('Requested writeFile out.txt')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('shows check icon when completed successfully', () => {
    const { container } = render(
      <ToolCallBlock
        name="readFile"
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
        name="readFile"
        args='{"path":"missing.ts"}'
        state="input-complete"
        result={{ content: '', state: 'error', error: 'File not found' }}
      />,
    )
    expect(screen.getByText('Read missing.ts')).toBeInTheDocument()
  })

  it('shows approval needed text', () => {
    render(<ToolCallBlock name="writeFile" args='{"path":"out.ts"}' state="approval-requested" />)
    expect(screen.getByText('(approval needed)')).toBeInTheDocument()
  })

  it('shows runCommand with backtick-wrapped verb', () => {
    render(
      <ToolCallBlock
        name="runCommand"
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
        name="readFile"
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
        name="readFile"
        args='{"path":"file.ts"}'
        state="input-complete"
        result={{ content: '"hello world"', state: 'success' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Result')).toBeInTheDocument()
  })

  it('shows command with $ prefix for runCommand args when expanded', () => {
    render(
      <ToolCallBlock
        name="runCommand"
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
        name="readFile"
        args='{"path":"missing.ts"}'
        state="input-complete"
        result={{ content: '', state: 'error', error: 'ENOENT' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('ENOENT')).toBeInTheDocument()
  })

  it('handles malformed JSON args gracefully', () => {
    render(<ToolCallBlock name="readFile" args="not-json" state="input-complete" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('not-json')).toBeInTheDocument()
  })
})
