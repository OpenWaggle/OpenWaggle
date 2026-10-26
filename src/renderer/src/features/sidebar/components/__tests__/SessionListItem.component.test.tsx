import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import { SessionListItem, type SessionRowHighlight } from '../SessionListItem'

const { copyToClipboardMock, showConfirmMock } = vi.hoisted(() => ({
  copyToClipboardMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    copyToClipboard: copyToClipboardMock,
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

const NOOP_ACTIONS = {
  select: vi.fn(),
  delete: vi.fn(),
  archive: vi.fn(),
  clone: vi.fn(),
  markUnread: vi.fn(),
  togglePin: vi.fn(),
}

function renderSessionItem(options?: { readonly highlight?: SessionRowHighlight }) {
  const callbacks = {
    onArchive: vi.fn(),
    onClone: vi.fn(),
    onDelete: vi.fn(),
    onMarkUnread: vi.fn(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  }

  render(
    <SessionListItem
      session={makeSession()}
      highlight={options?.highlight ?? 'none'}
      actions={{
        select: callbacks.onSelect,
        delete: callbacks.onDelete,
        archive: callbacks.onArchive,
        clone: callbacks.onClone,
        markUnread: callbacks.onMarkUnread,
        togglePin: callbacks.onTogglePin,
      }}
    />,
  )

  return callbacks
}

function expectFullSessionActionMenu() {
  expect(screen.getByText('Mark as unread')).toBeInTheDocument()
  expect(screen.getByText('Clone to new session')).toBeInTheDocument()
  expect(screen.getByText('Copy session link')).toBeInTheDocument()
  expect(screen.getByText('Archive session')).toBeInTheDocument()
  expect(screen.getByText('Delete session')).toBeInTheDocument()
}

describe('SessionListItem', () => {
  it('keeps a Queen row secondarily highlighted while a Worker of her Hive is open', () => {
    renderSessionItem({ highlight: 'hive-home' })

    const row = document.querySelector('[data-qa="sidebar-session-row-hive-home"]')
    expect(row).not.toBeNull()
    // A distinct highlight: the active background plus an accent ring, no aria-current.
    expect(row?.className).toContain('ring-accent/40')
    expect(row?.getAttribute('aria-current')).toBeNull()
    expect(row?.getAttribute('title')).toContain('Worker of this Queen')
  })

  it('keeps the row description in the Hive home title', () => {
    render(
      <SessionListItem
        session={makeSession()}
        highlight="hive-home"
        actions={NOOP_ACTIONS}
        isPinned
        pinnedRow={{
          projectLabel: 'Repo',
          shortcutIndex: null,
          draggable: false,
          onMoveUp: null,
          onMoveDown: null,
        }}
      />,
    )

    const row = document.querySelector('[data-qa="sidebar-session-row-hive-home"]')
    expect(row?.getAttribute('title')).toBe(
      'Repo \u2014 A Worker of this Queen\u2019s Hive is open',
    )
  })

  it("reports hidden Workers that need attention on a Queen row, in the Hive panel's words", () => {
    const queen = makeSession({
      lineage: { role: 'queen', directWorkerCount: 3, activeDirectWorkerCount: 2 },
    })
    const { rerender } = render(
      <SessionListItem session={queen} actions={NOOP_ACTIONS} workerAttentionCount={2} />,
    )
    expect(document.querySelector('[data-qa="sidebar-row-worker-attention"]')?.textContent).toBe(
      '2 need attention',
    )

    rerender(<SessionListItem session={queen} actions={NOOP_ACTIONS} workerAttentionCount={1} />)
    expect(document.querySelector('[data-qa="sidebar-row-worker-attention"]')?.textContent).toBe(
      '1 needs attention',
    )

    rerender(<SessionListItem session={queen} actions={NOOP_ACTIONS} workerAttentionCount={0} />)
    expect(document.querySelector('[data-qa="sidebar-row-worker-attention"]')).toBeNull()
  })

  it('does not mark an ordinary row as the Hive home', () => {
    renderSessionItem({})

    expect(document.querySelector('[data-qa="sidebar-session-row"]')).not.toBeNull()
    expect(document.querySelector('[data-qa="sidebar-session-row-hive-home"]')).toBeNull()
  })

  beforeEach(() => {
    showConfirmMock.mockReset()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
  })

  it('shows every session action from the context menu even when the session is active', async () => {
    const callbacks = renderSessionItem({ highlight: 'active' })
    expect(screen.getByRole('listitem')).toHaveAttribute('data-session-id', SESSION_ID)
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

  it('copies the Session link, closes the menu, and confirms the copy', () => {
    renderSessionItem()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Target session' }))
    fireEvent.click(screen.getByText('Copy session link'))

    expect(copyToClipboardMock).toHaveBeenCalledWith('openwaggle://sessions/session-1')
    expect(screen.queryByText('Copy session link')).not.toBeInTheDocument()
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'Session link copied: openwaggle://sessions/session-1',
      variant: 'success',
    })
  })
})
