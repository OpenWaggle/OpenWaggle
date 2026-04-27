import type { UIMessage } from '@shared/types/chat-ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCopyToClipboard = vi.fn()

vi.mock('@/lib/ipc', () => ({
  api: {
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}))

import { UserMessageBubble } from '../UserMessageBubble'

function createUserMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'user', parts }
}

describe('UserMessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
        name: 'read',
        arguments: '{}',
        state: 'output-available',
      },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('read')).not.toBeInTheDocument()
  })

  it('renders bold text via markdown', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: '**bold text**' }])
    const { container } = render(<UserMessageBubble message={message} />)
    const strong = container.querySelector('strong')
    expect(strong).toBeInTheDocument()
    expect(strong?.textContent).toBe('bold text')
  })

  it('renders a numbered list via markdown', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: '1. First item\n2. Second item\n3. Third item' },
    ])
    const { container } = render(<UserMessageBubble message={message} />)
    const ol = container.querySelector('ol')
    expect(ol).toBeInTheDocument()
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toBe('First item')
  })

  it('renders a fenced code block via markdown', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: '```js\nconst x = 1;\n```' }])
    const { container } = render(<UserMessageBubble message={message} />)
    const pre = container.querySelector('pre')
    expect(pre).toBeInTheDocument()
    const code = container.querySelector('code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toContain('const x = 1;')
  })

  it('renders @mention chips inside markdown paragraphs', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'Check @src/main/index.ts please' },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText(/Check/)).toBeInTheDocument()
  })

  it('does not render @mentions inside inline code as chips', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'Use `@src/main/index.ts` for reference' },
    ])
    const { container } = render(<UserMessageBubble message={message} />)
    const codeEl = container.querySelector('code')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl?.textContent).toBe('@src/main/index.ts')
    // The mention chip renders basename in a separate span — it should NOT appear
    const chips = container.querySelectorAll('[title="src/main/index.ts"]')
    expect(chips).toHaveLength(0)
  })

  it('copy button calls api.copyToClipboard with raw text', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: '**bold** and `code`' }])
    render(<UserMessageBubble message={message} />)
    const copyButton = screen.getByTitle('Copy message')
    fireEvent.click(copyButton)
    expect(mockCopyToClipboard).toHaveBeenCalledWith('**bold** and `code`')
  })

  it('calls the branch callback with the message id', () => {
    const message = createUserMessage('u-branch', [{ type: 'text', content: 'branch here' }])
    const onBranchFromMessage = vi.fn()

    render(<UserMessageBubble message={message} onBranchFromMessage={onBranchFromMessage} />)
    fireEvent.click(screen.getByTitle('Branch from message'))

    expect(onBranchFromMessage).toHaveBeenCalledWith('u-branch')
  })

  it('renders the prose-user CSS class for compact styling', () => {
    const message = createUserMessage('u1', [{ type: 'text', content: 'Test' }])
    const { container } = render(<UserMessageBubble message={message} />)
    const proseDiv = container.querySelector('.prose-user')
    expect(proseDiv).toBeInTheDocument()
  })

  it('renders attachment text parts as chips instead of markdown', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'Check this file' },
      { type: 'text', content: '[Attachment] report.pdf' },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('Check this file')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    // The attachment name should be in a chip, not rendered as markdown
    expect(screen.queryByText('[Attachment] report.pdf')).not.toBeInTheDocument()
  })

  it('renders multiple attachment chips', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: '[Attachment] image.png' },
      { type: 'text', content: '[Attachment] document.pdf' },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('image.png')).toBeInTheDocument()
    expect(screen.getByText('document.pdf')).toBeInTheDocument()
  })

  it('extracts attachment name from first line when preview text is present', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: '[Attachment] data.csv\nid,name,value\n1,foo,42' },
    ])
    render(<UserMessageBubble message={message} />)
    expect(screen.getByText('data.csv')).toBeInTheDocument()
    // The extracted preview text should not appear in the chip
    expect(screen.queryByText(/id,name,value/)).not.toBeInTheDocument()
  })

  it('excludes attachment text parts from copy content', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'Main message' },
      { type: 'text', content: '[Attachment] file.txt' },
    ])
    render(<UserMessageBubble message={message} />)
    const copyButton = screen.getByTitle('Copy message')
    fireEvent.click(copyButton)
    expect(mockCopyToClipboard).toHaveBeenCalledWith('Main message')
  })
})
