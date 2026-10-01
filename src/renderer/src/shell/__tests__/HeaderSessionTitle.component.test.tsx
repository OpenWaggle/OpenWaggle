import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import { HeaderLeft } from '../HeaderControls'

const { updateSessionTitleMock } = vi.hoisted(() => ({
  updateSessionTitleMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSessionTitle: updateSessionTitleMock,
  },
}))

const SESSION_ID = SessionId('header-session')
const TITLE = 'Investigate the slow sidebar'

function seedSession() {
  const session = {
    id: SESSION_ID,
    title: TITLE,
    projectPath: '/repo',
    messageCount: 2,
    createdAt: 1,
    updatedAt: 2,
  }
  useSessionStore.setState({ sessions: [session], activeSessionTree: null, activeWorkspace: null })
  useChatStore.setState({ sessions: [session], sessionById: new Map() })
}

/** The header reads its title the way Header does, from the Session catalog. */
function StoreBackedHeader({ sessionId }: { readonly sessionId: SessionId | null }) {
  const title = useSessionStore(
    (state) => state.sessions.find((session) => session.id === sessionId)?.title ?? 'New session',
  )
  return (
    <HeaderLeft
      activeBranchName={null}
      projectPath="/repo"
      sessionId={sessionId}
      sidebarOpen
      title={title}
      onToggleSidebar={vi.fn()}
    />
  )
}

function titleField() {
  return screen.getByRole('textbox', { name: 'Session title' })
}

describe('Session identity header rename', () => {
  beforeEach(() => {
    updateSessionTitleMock.mockReset()
    updateSessionTitleMock.mockResolvedValue(undefined)
    useUIStore.setState({ toastMessage: null, toastData: null })
    seedSession()
  })

  it('renames the selected Session on double-click and Enter', async () => {
    render(<StoreBackedHeader sessionId={SESSION_ID} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: TITLE }))
    expect(titleField()).toHaveValue(TITLE)
    expect(titleField()).toHaveFocus()

    fireEvent.change(titleField(), { target: { value: ' Slow sidebar ' } })
    fireEvent.keyDown(titleField(), { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Slow sidebar' })).toBeInTheDocument()
    await waitFor(() =>
      expect(updateSessionTitleMock).toHaveBeenCalledWith(SESSION_ID, 'Slow sidebar'),
    )
  })

  it('cancels on Escape and does not save on the blur that follows', () => {
    render(<StoreBackedHeader sessionId={SESSION_ID} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: TITLE }))
    const field = titleField()
    fireEvent.change(field, { target: { value: 'Discarded' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.blur(field)

    expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument()
    expect(updateSessionTitleMock).not.toHaveBeenCalled()
  })

  it('saves on blur and cancels a blank title without IPC', async () => {
    render(<StoreBackedHeader sessionId={SESSION_ID} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: TITLE }))
    fireEvent.change(titleField(), { target: { value: '   ' } })
    fireEvent.blur(titleField())
    expect(updateSessionTitleMock).not.toHaveBeenCalled()

    fireEvent.doubleClick(screen.getByRole('button', { name: TITLE }))
    fireEvent.change(titleField(), { target: { value: 'Blurred header title' } })
    fireEvent.blur(titleField())
    await waitFor(() =>
      expect(updateSessionTitleMock).toHaveBeenCalledWith(SESSION_ID, 'Blurred header title'),
    )
  })

  it('reverts the header title when the rename is rejected', async () => {
    updateSessionTitleMock.mockRejectedValueOnce(new Error('offline'))
    render(<StoreBackedHeader sessionId={SESSION_ID} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: TITLE }))
    fireEvent.change(titleField(), { target: { value: 'Rejected' } })
    fireEvent.keyDown(titleField(), { key: 'Enter' })

    await waitFor(() => expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument())
    expect(useUIStore.getState().toastData?.variant).toBe('error')
  })

  it('does not offer rename for a new-session draft', () => {
    render(<StoreBackedHeader sessionId={null} />)

    fireEvent.doubleClick(screen.getByText('New session'))

    expect(screen.queryByRole('textbox', { name: 'Session title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument()
  })
})
