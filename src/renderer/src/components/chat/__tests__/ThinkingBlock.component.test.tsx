import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThinkingBlock } from '../ThinkingBlock'

describe('ThinkingBlock', () => {
  it('renders collapsed by default with Brain icon', () => {
    const { container } = render(<ThinkingBlock content="Let me think about this..." />)
    // Brain icon is rendered (no spinner)
    expect(container.querySelector('.animate-spin')).toBeNull()
    // Token estimate shown
    expect(screen.getByText(/Thought for \d+ tokens/)).toBeInTheDocument()
    // Content not visible when collapsed
    expect(screen.queryByText('Let me think about this...')).toBeNull()
  })

  it('shows "Thinking..." with spinner when isStreaming', () => {
    const { container } = render(<ThinkingBlock content="partial thought" isStreaming />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('expands on click and shows content', () => {
    render(<ThinkingBlock content="Deep reasoning about the problem" />)

    // Click to expand
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Deep reasoning about the problem')).toBeInTheDocument()
  })

  it('collapses on second click', () => {
    render(<ThinkingBlock content="Some reasoning" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Some reasoning')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByText('Some reasoning')).toBeNull()
  })

  it('shows token estimate when not streaming', () => {
    // 100 chars ≈ 25 tokens (ceil(100/4))
    const content = 'a'.repeat(100)
    render(<ThinkingBlock content={content} />)
    expect(screen.getByText('Thought for 25 tokens')).toBeInTheDocument()
  })
})
