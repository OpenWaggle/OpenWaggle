import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { SessionListItem } from '../SessionListItem'

const { showConfirmMock } = vi.hoisted(() => ({
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    showConfirm: showConfirmMock,
  },
}))

const SESSION_ID = SessionId('session-1')

function makeSession(overrides?: Partial<SessionSummary>) {
  return {
    id: SESSION_ID,
    title: 'Target session',
    projectPath: '/repo',
    messageCount: 4,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function renderSessionItem(options?: { readonly isActive?: boolean }) {
  const callbacks = {
    onArchive: vi.fn(),
    onClone: vi.fn(),
    onDelete: vi.fn(),
    onMarkUnread: vi.fn(),
    onSelect: vi.fn(),
  }

  render(
    <SessionListItem
      session={makeSession()}
      isActive={options?.isActive ?? false}
      actions={{
        select: callbacks.onSelect,
        delete: callbacks.onDelete,
        archive: callbacks.onArchive,
        clone: callbacks.onClone,
        markUnread: callbacks.onMarkUnread,
      }}
    />,
  )

  return callbacks
}

function expectFullSessionActionMenu() {
  expect(screen.getByText('Mark as unread')).toBeInTheDocument()
  expect(screen.getByText('Clone to new session')).toBeInTheDocument()
  expect(screen.getByText('Archive session')).toBeInTheDocument()
  expect(screen.getByText('Delete session')).toBeInTheDocument()
}

describe('SessionListItem', () => {
  beforeEach(() => {
    showConfirmMock.mockReset()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
  })

  it('shows every session action from the context menu even when the session is active', async () => {
    const callbacks = renderSessionItem({ isActive: true })
    showConfirmMock.mockResolvedValueOnce(true)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Target session' }))

    expectFullSessionActionMenu()

    fireEvent.click(screen.getByText('Delete session'))

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalledWith('Delete this session?', 'This cannot be undone.')
      expect(callbacks.onDelete).toHaveBeenCalledWith(SESSION_ID)
    })
  })

  it('opens the same session action menu from the hover actions button', () => {
    const callbacks = renderSessionItem()

    fireEvent.click(screen.getByRole('button', { name: 'Open session actions for Target session' }))

    expectFullSessionActionMenu()

    fireEvent.click(screen.getByText('Archive session'))

    expect(callbacks.onArchive).toHaveBeenCalledWith(SESSION_ID)
  })
})
