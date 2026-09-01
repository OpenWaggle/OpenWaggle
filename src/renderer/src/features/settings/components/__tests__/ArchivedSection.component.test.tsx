import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ArchivedSection } from '../sections/ArchivedSection'

const {
  deleteSessionMock,
  listArchivedSessionBranchesMock,
  loadMoreArchivedSessionsMock,
  loadSessionsMock,
  restoreSessionBranchMock,
  showConfirmMock,
  unarchiveSessionMock,
} = vi.hoisted(() => ({
  deleteSessionMock: vi.fn(),
  listArchivedSessionBranchesMock: vi.fn(),
  loadMoreArchivedSessionsMock: vi.fn(),
  loadSessionsMock: vi.fn(),
  restoreSessionBranchMock: vi.fn(),
  showConfirmMock: vi.fn(),
  unarchiveSessionMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listArchivedSessionBranches: listArchivedSessionBranchesMock,
    unarchiveSession: unarchiveSessionMock,
    restoreSessionBranch: restoreSessionBranchMock,
    deleteSession: deleteSessionMock,
    showConfirm: showConfirmMock,
  },
}))

interface MockSessionStoreState {
  archivedSessions: SessionSummary[]
  archivedSessionsNextCursor: string | null
  archivedSessionsLoadingMore: boolean
  loadMoreArchivedSessions: typeof loadMoreArchivedSessionsMock
  loadSessions: typeof loadSessionsMock
}

const sessionStoreState: MockSessionStoreState = {
  archivedSessions: [],
  archivedSessionsNextCursor: null,
  archivedSessionsLoadingMore: false,
  loadMoreArchivedSessions: loadMoreArchivedSessionsMock,
  loadSessions: loadSessionsMock,
}

vi.mock('@/features/sessions/state/session-store', () => ({
  useSessionStore: (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
}))

function createArchivedSession(overrides?: Partial<SessionSummary>) {
  return {
    id: SessionId('session-1'),
    title: 'Archived session',
    projectPath: '/tmp/project',
    messageCount: 4,
    createdAt: 1,
    updatedAt: 2,
    archived: true,
    ...overrides,
  }
}

function createArchivedBranchSession(overrides?: Partial<SessionSummary>) {
  const sessionId = SessionId('session-1')
  return {
    id: sessionId,
    title: 'Session with archived branch',
    projectPath: '/tmp/project',
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    lastActiveNodeId: null,
    lastActiveBranchId: null,
    branches: [
      {
        id: SessionBranchId('branch-1'),
        sessionId,
        sourceNodeId: null,
        headNodeId: null,
        name: 'Archived branch',
        isMain: false,
        archived: true,
        archivedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    treeUiState: null,
    ...overrides,
  }
}

function createDeferredPromise<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise,
  }
}

describe('ArchivedSection', () => {
  beforeEach(() => {
    deleteSessionMock.mockReset()
    listArchivedSessionBranchesMock.mockReset()
    loadMoreArchivedSessionsMock.mockReset()
    loadSessionsMock.mockReset()
    restoreSessionBranchMock.mockReset()
    showConfirmMock.mockReset()
    unarchiveSessionMock.mockReset()
    sessionStoreState.archivedSessions = []
    sessionStoreState.archivedSessionsNextCursor = null
    sessionStoreState.archivedSessionsLoadingMore = false
    listArchivedSessionBranchesMock.mockResolvedValue({ sessions: [] })
    loadMoreArchivedSessionsMock.mockResolvedValue(undefined)
    loadSessionsMock.mockResolvedValue(undefined)
  })

  it('shows a loading state while archived sessions are being fetched', () => {
    const deferred = createDeferredPromise<{ sessions: readonly SessionSummary[] }>()
    listArchivedSessionBranchesMock.mockReturnValueOnce(deferred.promise)

    renderWithQueryClient(<ArchivedSection />)

    expect(screen.getByText(/loading archived sessions/i)).toBeInTheDocument()
    deferred.resolve({ sessions: [] })
  })

  it('shows the empty state when there are no archived sessions or branches', async () => {
    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText(/no archived sessions/i)).toBeInTheDocument()
  })

  it('loads another bounded page when archived Sessions remain', async () => {
    sessionStoreState.archivedSessions = Array.from({ length: 100 }, (_, index) =>
      createArchivedSession({
        id: SessionId(`archived-${String(index)}`),
        title: `Archived ${String(index)}`,
      }),
    )
    sessionStoreState.archivedSessionsNextCursor = 'next-archived-page'

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more archived items' }))

    await waitFor(() => expect(loadMoreArchivedSessionsMock).toHaveBeenCalledOnce())
  })

  it('loads archived branch pages by keyset cursor', async () => {
    const session = createArchivedBranchSession()
    listArchivedSessionBranchesMock
      .mockResolvedValueOnce({ sessions: [session], nextCursor: 'next-branch-page' })
      .mockResolvedValueOnce({ sessions: [] })

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more archived items' }))

    await waitFor(() => {
      expect(listArchivedSessionBranchesMock).toHaveBeenNthCalledWith(1, 100, undefined)
      expect(listArchivedSessionBranchesMock).toHaveBeenNthCalledWith(2, 100, 'next-branch-page')
    })
  })

  it('restores an archived session and refreshes the bounded catalog', async () => {
    const session = createArchivedSession()
    sessionStoreState.archivedSessions = [session]
    unarchiveSessionMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Restore session'))

    await waitFor(() => {
      expect(unarchiveSessionMock).toHaveBeenCalledWith(session.id)
      expect(loadSessionsMock).toHaveBeenCalledOnce()
    })
  })

  it('restores an archived branch without navigating to it', async () => {
    const session = createArchivedBranchSession()
    const branch = session.branches?.[0]
    listArchivedSessionBranchesMock
      .mockResolvedValueOnce({ sessions: [session] })
      .mockResolvedValueOnce({ sessions: [] })
    restoreSessionBranchMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Restore branch'))

    await waitFor(() => {
      expect(branch).toBeDefined()
      expect(restoreSessionBranchMock).toHaveBeenCalledWith(session.id, branch?.id)
      expect(listArchivedSessionBranchesMock).toHaveBeenCalledTimes(2)
      expect(loadSessionsMock).toHaveBeenCalledOnce()
      expect(screen.getByText(/no archived sessions or branches/i)).toBeInTheDocument()
    })
  })

  it('deletes an archived session after confirmation and refreshes the bounded catalog', async () => {
    const session = createArchivedSession()
    sessionStoreState.archivedSessions = [session]
    showConfirmMock.mockResolvedValueOnce(true)
    deleteSessionMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalled()
      expect(deleteSessionMock).toHaveBeenCalledWith(session.id)
      expect(loadSessionsMock).toHaveBeenCalledOnce()
    })
  })

  it('keeps archived sessions visible when deleting fails after confirmation', async () => {
    const session = createArchivedSession()
    sessionStoreState.archivedSessions = [session]
    showConfirmMock.mockResolvedValueOnce(true)
    deleteSessionMock.mockRejectedValueOnce(new Error('Delete exploded'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Delete exploded')
      expect(screen.getByText('Archived session')).toBeInTheDocument()
    })
  })

  it('shows an inline error when opening the delete confirmation fails', async () => {
    const session = createArchivedSession()
    sessionStoreState.archivedSessions = [session]
    showConfirmMock.mockRejectedValueOnce(new Error('Dialog unavailable'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Dialog unavailable')
      expect(screen.getByText('Archived session')).toBeInTheDocument()
    })
  })
})
