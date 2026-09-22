import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const capturedResources: {
  value: { readonly title: string; readonly attachmentIndex: number | null }[]
} = vi.hoisted(() => ({ value: [] }))

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: vi.fn() } }))
vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: () => capturedResources.value,
}))

import { UserMessageBubble } from '../UserMessageBubble'

function userMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'user', parts }
}

beforeEach(() => {
  capturedResources.value = []
})

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

it('keeps the blob preview valid across transcript unmounts', () => {
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
  const message = userMessage('u-switching-session', [
    { type: 'image', source: { value: 'blob:session-preview' }, name: 'screenshot.png' },
  ])

  const { unmount } = render(<UserMessageBubble message={message} />)
  unmount()

  expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:session-preview')
  revokeObjectUrl.mockRestore()
})

it('releases the blob preview when a durable Session image replaces it', () => {
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
  const message = userMessage('u-durable-image', [
    { type: 'image', source: { value: 'blob:durable-image' }, name: 'screenshot.png' },
  ])
  const { rerender } = render(<UserMessageBubble message={message} />)

  capturedResources.value = [{ title: 'screenshot.png', attachmentIndex: 0 }]
  rerender(<UserMessageBubble message={message} />)

  expect(revokeObjectUrl).toHaveBeenCalledWith('blob:durable-image')
  revokeObjectUrl.mockRestore()
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
