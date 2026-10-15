import type { UIMessage } from '@shared/types/chat-ui'
import { render } from '@testing-library/react'
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
  it('keeps every typed or pasted line break as a line break', () => {
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
    expect(paragraph?.textContent).toBe(
      '1, I will grant you access\n2. but the blob storage is shared\n3. it should be private',
    )
  })

  it('still renders Markdown the user writes', () => {
    const message = createUserMessage('u1', [
      {
        type: 'text',
        content:
          '## Plan\n\n- **first** step\n- second step\n\n```ts\nconst a = 1\nconst b = 2\n```',
      },
    ])
    const { container } = render(<UserMessageBubble message={message} />)

    expect(container.querySelector('.prose-user h2')?.textContent).toBe('Plan')
    expect(container.querySelectorAll('.prose-user li')).toHaveLength(2)
    expect(container.querySelector('.prose-user strong')?.textContent).toBe('first')
    expect(container.querySelector('.prose-user pre br')).toBeNull()
    expect(container.querySelector('.prose-user pre')?.textContent).toContain(
      'const a = 1\nconst b = 2',
    )
  })
})
