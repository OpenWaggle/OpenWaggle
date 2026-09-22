import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: vi.fn() } }))
vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: () => [],
}))

import { UserMessageBubble } from '../UserMessageBubble'

function userMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'user', parts }
}

it('renders an optimistic image preview without exposing its attachment label', () => {
  const message = userMessage('u-optimistic-image', [
    {
      type: 'image',
      source: { value: 'blob:optimistic-image' },
      name: 'screenshot.png',
      attachmentIndex: 0,
    },
    { type: 'text', content: 'Fix this layout' },
    { type: 'text', content: '[Attachment] screenshot.png' },
  ])

  render(<UserMessageBubble message={message} />)

  expect(screen.getByRole('img', { name: 'screenshot.png' })).toHaveAttribute(
    'src',
    'blob:optimistic-image',
  )
  expect(screen.getByText('Fix this layout')).toBeInTheDocument()
  expect(screen.queryByText('screenshot.png')).toBeNull()
})

it('hides legacy Pi image placeholders', () => {
  const message = userMessage('u-legacy-image', [
    { type: 'text', content: 'Fix this layout' },
    { type: 'text', content: '[Image input: image/png]' },
  ])

  render(<UserMessageBubble message={message} />)

  expect(screen.getByText('Fix this layout')).toBeInTheDocument()
  expect(screen.queryByText('[Image input: image/png]')).toBeNull()
})
