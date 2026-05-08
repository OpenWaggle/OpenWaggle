import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '../../../test-utils/query-test-utils'
import { ArchivedSection } from '../sections/ArchivedSection'

const {
  deleteSessionMock,
  listArchivedSessionsMock,
  listArchivedSessionBranchesMock,
  loadSessionsMock,
  restoreSessionBranchMock,
  showConfirmMock,
  unarchiveSessionMock,
} = vi.hoisted(() => ({
  deleteSessionMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  listArchivedSessionBranchesMock: vi.fn(),
  loadSessionsMock: vi.fn(),
  restoreSessionBranchMock: vi.fn(),
  showConfirmMock: vi.fn(),
  unarchiveSessionMock: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listArchivedSessions: listArchivedSessionsMock,
    listArchivedSessionBranches: listArchivedSessionBranchesMock,
    unarchiveSession: unarchiveSessionMock,
    restoreSessionBranch: restoreSessionBranchMock,
    deleteSession: deleteSessionMock,
    showConfirm: showConfirmMock,
  },
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: (selector: (state: { readonly loadSessions: () => Promise<void> }) => unknown) =>
    selector({ loadSessions: loadSessionsMock }),
}))

function createArchivedSession(overrides?: Partial<SessionSummary>): SessionSummary {
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

function createArchivedBranchSession(overrides?: Partial<SessionSummary>): SessionSummary {
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
    listArchivedSessionsMock.mockReset()
    listArchivedSessionBranchesMock.mockReset()
    loadSessionsMock.mockReset()
    restoreSessionBranchMock.mockReset()
    showConfirmMock.mockReset()
    unarchiveSessionMock.mockReset()
    listArchivedSessionBranchesMock.mockResolvedValue([])
    loadSessionsMock.mockResolvedValue(undefined)
  })

  it('shows a loading state while archived sessions are being fetched', () => {
    const deferred = createDeferredPromise<SessionSummary[]>()
    listArchivedSessionsMock.mockReturnValueOnce(deferred.promise)

    renderWithQueryClient(<ArchivedSection />)

    expect(screen.getByText(/loading archived sessions/i)).toBeInTheDocument()
    deferred.resolve([])
  })

  it('shows the empty state when there are no archived sessions or branches', async () => {
    listArchivedSessionsMock.mockResolvedValueOnce([])

    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText(/no archived sessions/i)).toBeInTheDocument()
  })

  it('restores an archived session and invalidates the archived query', async () => {
    const session = createArchivedSession()
    listArchivedSessionsMock.mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    unarchiveSessionMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Restore session'))

    await waitFor(() => {
      expect(unarchiveSessionMock).toHaveBeenCalledWith(session.id)
      expect(listArchivedSessionsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/no archived sessions/i)).toBeInTheDocument()
    })
  })

  it('restores an archived branch without navigating to it', async () => {
    const session = createArchivedBranchSession()
    const branch = session.branches?.[0]
    listArchivedSessionsMock.mockResolvedValueOnce([])
    listArchivedSessionBranchesMock.mockResolvedValueOnce([session]).mockResolvedValueOnce([])
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

  it('deletes an archived session after confirmation and invalidates the archived query', async () => {
    const session = createArchivedSession()
    listArchivedSessionsMock.mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    showConfirmMock.mockResolvedValueOnce(true)
    deleteSessionMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalled()
      expect(deleteSessionMock).toHaveBeenCalledWith(session.id)
      expect(listArchivedSessionsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/no archived sessions/i)).toBeInTheDocument()
    })
  })

  it('keeps archived sessions visible when deleting fails after confirmation', async () => {
    const session = createArchivedSession()
    listArchivedSessionsMock.mockResolvedValueOnce([session])
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
    listArchivedSessionsMock.mockResolvedValueOnce([session])
    showConfirmMock.mockRejectedValueOnce(new Error('Dialog unavailable'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Dialog unavailable')
      expect(screen.getByText('Archived session')).toBeInTheDocument()
    })
  })
})
