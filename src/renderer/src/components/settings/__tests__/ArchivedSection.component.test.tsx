import { ConversationId, SessionBranchId, SessionId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ArchivedSection } from '../sections/ArchivedSection'

const {
  deleteConversationMock,
  listArchivedConversationsMock,
  listArchivedSessionBranchesMock,
  loadSessionsMock,
  restoreSessionBranchMock,
  showConfirmMock,
  unarchiveConversationMock,
} = vi.hoisted(() => ({
  deleteConversationMock: vi.fn(),
  listArchivedConversationsMock: vi.fn(),
  listArchivedSessionBranchesMock: vi.fn(),
  loadSessionsMock: vi.fn(),
  restoreSessionBranchMock: vi.fn(),
  showConfirmMock: vi.fn(),
  unarchiveConversationMock: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listArchivedConversations: listArchivedConversationsMock,
    listArchivedSessionBranches: listArchivedSessionBranchesMock,
    unarchiveConversation: unarchiveConversationMock,
    restoreSessionBranch: restoreSessionBranchMock,
    deleteConversation: deleteConversationMock,
    showConfirm: showConfirmMock,
  },
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: (selector: (state: { readonly loadSessions: () => Promise<void> }) => unknown) =>
    selector({ loadSessions: loadSessionsMock }),
}))

function createArchivedConversation(overrides?: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: ConversationId('conv-1'),
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
    deleteConversationMock.mockReset()
    listArchivedConversationsMock.mockReset()
    listArchivedSessionBranchesMock.mockReset()
    loadSessionsMock.mockReset()
    restoreSessionBranchMock.mockReset()
    showConfirmMock.mockReset()
    unarchiveConversationMock.mockReset()
    listArchivedSessionBranchesMock.mockResolvedValue([])
    loadSessionsMock.mockResolvedValue(undefined)
  })

  it('shows a loading state while archived sessions are being fetched', () => {
    const deferred = createDeferredPromise<ConversationSummary[]>()
    listArchivedConversationsMock.mockReturnValueOnce(deferred.promise)

    renderWithQueryClient(<ArchivedSection />)

    expect(screen.getByText(/loading archived sessions/i)).toBeInTheDocument()
    deferred.resolve([])
  })

  it('shows the empty state when there are no archived sessions or branches', async () => {
    listArchivedConversationsMock.mockResolvedValueOnce([])

    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText(/no archived sessions/i)).toBeInTheDocument()
  })

  it('restores an archived session and invalidates the archived query', async () => {
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation]).mockResolvedValueOnce([])
    unarchiveConversationMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Restore session'))

    await waitFor(() => {
      expect(unarchiveConversationMock).toHaveBeenCalledWith(conversation.id)
      expect(listArchivedConversationsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/no archived sessions/i)).toBeInTheDocument()
    })
  })

  it('restores an archived branch without navigating to it', async () => {
    const session = createArchivedBranchSession()
    const branch = session.branches?.[0]
    listArchivedConversationsMock.mockResolvedValueOnce([])
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
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation]).mockResolvedValueOnce([])
    showConfirmMock.mockResolvedValueOnce(true)
    deleteConversationMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalled()
      expect(deleteConversationMock).toHaveBeenCalledWith(conversation.id)
      expect(listArchivedConversationsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/no archived sessions/i)).toBeInTheDocument()
    })
  })

  it('keeps archived sessions visible when deleting fails after confirmation', async () => {
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation])
    showConfirmMock.mockResolvedValueOnce(true)
    deleteConversationMock.mockRejectedValueOnce(new Error('Delete exploded'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Delete exploded')
      expect(screen.getByText('Archived session')).toBeInTheDocument()
    })
  })

  it('shows an inline error when opening the delete confirmation fails', async () => {
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation])
    showConfirmMock.mockRejectedValueOnce(new Error('Dialog unavailable'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Dialog unavailable')
      expect(screen.getByText('Archived session')).toBeInTheDocument()
    })
  })
})
