import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: () => [],
}))

import { UserMessageBubble } from '../UserMessageBubble'

function renderBubble(metadata: UIMessage['metadata']) {
  const message: UIMessage = {
    id: 'optimistic-steer-1',
    role: 'user',
    parts: [{ type: 'text', content: 'Continue with the implementation' }],
    ...(metadata ? { metadata } : {}),
  }
  const { container } = render(
    <UserMessageBubble
      message={message}
      onBranchFromMessage={vi.fn()}
      onForkFromMessage={vi.fn()}
    />,
  )
  return container.querySelector('[class*="rounded-2xl"]')
}

it('marks a steered preview that is waiting for compaction to finish', () => {
  const bubble = renderBubble({ steerDelivery: 'waiting-for-compaction' })

  expect(screen.getByText('Continue with the implementation')).toBeInTheDocument()
  expect(screen.getByText('Will send after compaction')).toBeInTheDocument()
  expect(screen.queryByText('Queued')).not.toBeInTheDocument()
  expect(bubble).toHaveClass('border-dashed', 'bg-transparent')
  expect(screen.queryByTitle('Branch from message')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Fork to new session')).not.toBeInTheDocument()
})

it('shows a steer the agent has not read yet as queued', () => {
  const bubble = renderBubble({ steerDelivery: 'sending' })

  expect(screen.getByText('Queued')).toBeInTheDocument()
  expect(screen.queryByText('Will send after compaction')).not.toBeInTheDocument()
  expect(bubble).toHaveClass('border-dashed', 'bg-transparent')
  expect(bubble).not.toHaveClass('bg-bg-hover')
  expect(screen.getByText('Continue with the implementation').closest('.prose')).toHaveClass(
    'text-text-secondary',
  )
})

it('shows a delivered message as a normal bubble', () => {
  const bubble = renderBubble(undefined)

  expect(screen.queryByText('Queued')).not.toBeInTheDocument()
  expect(bubble).toHaveClass('bg-bg-hover')
  expect(bubble).not.toHaveClass('border-dashed')
  expect(screen.getByText('Continue with the implementation').closest('.prose')).not.toHaveClass(
    'text-text-secondary',
  )
})
