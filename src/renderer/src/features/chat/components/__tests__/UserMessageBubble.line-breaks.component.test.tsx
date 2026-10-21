import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({
  api: { copyToClipboard: vi.fn() },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => vi.fn(),
}))

vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => <div data-testid="session-message-images" />,
  useSessionMessageImageResources: () => [],
}))

import { UserMessageBubble } from '../UserMessageBubble'

function createUserMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'user', parts }
}

describe('UserMessageBubble line breaks', () => {
  it('renders each single newline as a line break', () => {
    const message = createUserMessage('u1', [
      {
        type: 'text',
        content:
          '1, I will grant you access\n2. but the blob storage is shared\n3. it should be private',
      },
    ])
    const { container } = render(<UserMessageBubble message={message} />)

    const paragraph = container.querySelector('.prose-user p')
    expect(paragraph?.querySelectorAll('br')).toHaveLength(2)
    expect(paragraph?.textContent).toContain('1, I will grant you access')
    expect(paragraph?.textContent).toContain('2. but the blob storage is shared')
    expect(paragraph?.textContent).toContain('3. it should be private')
  })

  it('keeps composer reference chips at the start and end of lines', () => {
    const message = createUserMessage('u1', [
      { type: 'text', content: 'look at @src/a.ts\n@src/b.ts, and\n/code-review please' },
    ])
    const { container } = render(<UserMessageBubble message={message} />)

    expect(screen.getByTitle('Open src/a.ts')).toBeInTheDocument()
    expect(screen.getByTitle('Open src/b.ts')).toBeInTheDocument()
    expect(screen.getByTitle('/code-review')).toBeInTheDocument()
    expect(container.querySelectorAll('.prose-user p br')).toHaveLength(2)
  })

  it('links a pasted Session link and nothing else under the openwaggle scheme', () => {
    const message = createUserMessage('u1', [
      {
        type: 'text',
        content: 'Check openwaggle://sessions/session-1\nand [this](openwaggle://app/index.html)',
      },
    ])
    render(<UserMessageBubble message={message} />)

    expect(screen.getByRole('link', { name: 'openwaggle://sessions/session-1' })).toHaveAttribute(
      'href',
      'openwaggle://sessions/session-1',
    )
    expect(screen.queryByRole('link', { name: 'this' })).toBeNull()
  })

  it('still renders Markdown the user writes', () => {
    const message = createUserMessage('u1', [
      {
        type: 'text',
        content:
          '## Plan\n\n- **first** step\n- second step\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1\nconst b = 2\n```',
      },
    ])
    const { container } = render(<UserMessageBubble message={message} />)

    expect(container.querySelector('.prose-user h2')?.textContent).toBe('Plan')
    expect(container.querySelectorAll('.prose-user li')).toHaveLength(2)
    expect(container.querySelector('.prose-user strong')?.textContent).toBe('first')
    expect(container.querySelectorAll('.prose-user td')).toHaveLength(2)
    expect(container.querySelector('.prose-user table br')).toBeNull()
    expect(container.querySelector('.prose-user pre')?.textContent).toContain(
      'const a = 1\nconst b = 2',
    )
  })
})
