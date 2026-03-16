import type { UIMessage } from '@tanstack/ai-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserMessageBubble } from '../UserMessageBubble'

function createUserMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'user', parts }
}

describe('UserMessageBubble', () => {
  it('renders text content from message parts', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: 'Hello world' }])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders multiple text parts', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'First part' },
      { type: 'text', content: 'Second part' },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('First part')).toBeInTheDocument()
    expect(screen.getByText('Second part')).toBeInTheDocument()
  })

  it('applies user bubble CSS classes', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: 'Test' }])
    const { container } = render(<UserMessageBubble message={message} />)
    const outerDiv = container.firstChild
    expect(outerDiv).toBeInstanceOf(HTMLDivElement)
    expect((outerDiv as HTMLDivElement).className).toContain('justify-end')
  })

  it('skips non-text parts', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'Visible' },
      {
        type: 'tool-call',
        id: 'tc-1',
        name: 'readFile',
        arguments: '{}',
        state: 'output-available',
      },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('readFile')).not.toBeInTheDocument()
  })
})
