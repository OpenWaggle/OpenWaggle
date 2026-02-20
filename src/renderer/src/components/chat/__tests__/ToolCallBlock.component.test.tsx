import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

describe('ToolCallBlock', () => {
  beforeEach(() => {
    // No store setup needed — ToolCallBlock is self-contained
  })

  it('renders tool display name for known tool', () => {
    render(<ToolCallBlock name="readFile" args='{"path":"src/main.ts"}' state="input-complete" />)
    expect(screen.getByText('Read File')).toBeInTheDocument()
  })

  it('renders tool name as fallback for unknown tool', () => {
    render(<ToolCallBlock name="customTool" args="{}" state="input-complete" />)
    expect(screen.getByText('customTool')).toBeInTheDocument()
  })

  it('shows summary for known tools', () => {
    render(<ToolCallBlock name="readFile" args='{"path":"src/index.ts"}' state="input-complete" />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('shows spinner when tool is running', () => {
    const { container } = render(
      <ToolCallBlock name="runCommand" args='{"command":"ls"}' state="running" />,
    )
    // Loader2 renders an svg with animate-spin class
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('shows Done badge when completed successfully', () => {
    render(
      <ToolCallBlock
        name="readFile"
        args='{"path":"file.ts"}'
        state="input-complete"
        result={{ content: 'file content', state: 'success' }}
      />,
    )
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('shows Error badge when result has error', () => {
    render(
      <ToolCallBlock
        name="readFile"
        args='{"path":"missing.ts"}'
        state="input-complete"
        result={{ content: '', state: 'error', error: 'File not found' }}
      />,
    )
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('shows Awaiting approval badge', () => {
    render(<ToolCallBlock name="writeFile" args='{"path":"out.ts"}' state="approval-requested" />)
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
  })

  it('expands to show arguments on click', () => {
    render(<ToolCallBlock name="readFile" args='{"path":"src/main.ts"}' state="input-complete" />)
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

  it('shows command with $ prefix for runCommand args', () => {
    render(
      <ToolCallBlock
        name="runCommand"
        args='{"command":"npm test"}'
        state="input-complete"
        result={{ content: '"passed"', state: 'success' }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    // "npm test" appears in header summary and expanded args — both valid
    const matches = screen.getAllByText('npm test')
    expect(matches.length).toBeGreaterThanOrEqual(2)
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
    // "Error" appears in badge and section label
    const errorLabels = screen.getAllByText('Error')
    expect(errorLabels.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('ENOENT')).toBeInTheDocument()
  })

  it('handles malformed JSON args gracefully', () => {
    render(<ToolCallBlock name="readFile" args="not-json" state="input-complete" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('not-json')).toBeInTheDocument()
  })
})
