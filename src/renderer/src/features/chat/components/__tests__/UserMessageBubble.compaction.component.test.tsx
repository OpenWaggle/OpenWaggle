import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { it, vi } from 'vitest'

vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: () => [],
}))

import { UserMessageBubble } from '../UserMessageBubble'

it('marks a steered preview that is waiting for compaction to finish', () => {
  const message: UIMessage = {
    id: 'optimistic-steer-1',
    role: 'user',
    parts: [{ type: 'text', content: 'Continue with the implementation' }],
    metadata: { steerDelivery: 'waiting-for-compaction' },
  }

  render(
    <UserMessageBubble
      message={message}
      onBranchFromMessage={vi.fn()}
      onForkFromMessage={vi.fn()}
    />,
  )

  expect(screen.getByText('Continue with the implementation')).toBeInTheDocument()
  expect(screen.getByText('Will send after compaction')).toBeInTheDocument()
  expect(screen.queryByTitle('Branch from message')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Fork to new session')).not.toBeInTheDocument()
})
