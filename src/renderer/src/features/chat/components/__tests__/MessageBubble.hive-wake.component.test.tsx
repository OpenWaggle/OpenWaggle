import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSessionMessageImageResources = vi.fn()

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: vi.fn() } }))
vi.mock('@/features/workspace-files/hooks', () => ({ useOpenWorkspaceFile: () => vi.fn() }))
vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: (...args: unknown[]) =>
    mockSessionMessageImageResources(...args),
}))

import { MessageBubble } from '../MessageBubble'

const CREATED_AT = new Date(Date.UTC(2026, 10, 6, 12, 31))
const RUNTIME = {
  sessionId: SessionId('session-queen'),
  extensions: { registry: null, projectPaths: [] },
}

function userRow(metadata: UIMessage['metadata'], text: string): UIMessage {
  return {
    id: 'u-row',
    role: 'user',
    parts: [{ type: 'text', content: text }],
    createdAt: CREATED_AT,
    ...(metadata === undefined ? {} : { metadata }),
  }
}

describe('MessageBubble Hive wake notice', () => {
  beforeEach(() => {
    mockSessionMessageImageResources.mockReturnValue([])
  })

  it('shows the Host’s notice, not a user message with edit or fork actions', () => {
    const { container } = render(
      <MessageBubble
        message={userRow({ hiveWake: true }, 'Worker updates arrived')}
        runtime={RUNTIME}
        actions={{ onBranchFromMessage: vi.fn(), onForkFromMessage: vi.fn() }}
      />,
    )

    expect(screen.getByText('Hive · Worker updates arrived')).toBeInTheDocument()
    const notice = container.querySelector('[data-hive-wake-notice]')
    expect(notice?.querySelector('time')).toHaveAttribute('dateTime', CREATED_AT.toISOString())
    expect(notice?.querySelector('svg.lucide-pickaxe')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit from here' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
  })

  it('keeps a message the user wrote as a bubble with its actions', () => {
    const { container } = render(
      <MessageBubble
        message={userRow(undefined, 'Add the epics to Herbert’s timeline')}
        runtime={RUNTIME}
        actions={{ onBranchFromMessage: vi.fn(), onForkFromMessage: vi.fn() }}
      />,
    )

    expect(container.querySelector('[data-hive-wake-notice]')).toBeNull()
    expect(screen.getByText('Add the epics to Herbert’s timeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit from here' })).toBeInTheDocument()
  })
})
