import { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ArchivedSection } from '../sections/ArchivedSection'

const {
  deleteConversationMock,
  listArchivedConversationsMock,
  showConfirmMock,
  unarchiveConversationMock,
} = vi.hoisted(() => ({
  deleteConversationMock: vi.fn(),
  listArchivedConversationsMock: vi.fn(),
  showConfirmMock: vi.fn(),
  unarchiveConversationMock: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listArchivedConversations: listArchivedConversationsMock,
    unarchiveConversation: unarchiveConversationMock,
    deleteConversation: deleteConversationMock,
    showConfirm: showConfirmMock,
  },
}))

function createArchivedConversation(overrides?: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: ConversationId('conv-1'),
    title: 'Archived thread',
    projectPath: '/tmp/project',
    messageCount: 4,
    createdAt: 1,
    updatedAt: 2,
    archived: true,
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
    showConfirmMock.mockReset()
    unarchiveConversationMock.mockReset()
  })

  it('shows a loading state while archived threads are being fetched', () => {
    const deferred = createDeferredPromise<ConversationSummary[]>()
    listArchivedConversationsMock.mockReturnValueOnce(deferred.promise)

    renderWithQueryClient(<ArchivedSection />)

    expect(screen.getByText(/loading archived threads/i)).toBeInTheDocument()
    deferred.resolve([])
  })

  it('shows the empty state when there are no archived threads', async () => {
    listArchivedConversationsMock.mockResolvedValueOnce([])

    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText(/no archived threads/i)).toBeInTheDocument()
  })

  it('restores an archived thread and invalidates the archived query', async () => {
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation]).mockResolvedValueOnce([])
    unarchiveConversationMock.mockResolvedValueOnce(undefined)

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Restore thread'))

    await waitFor(() => {
      expect(unarchiveConversationMock).toHaveBeenCalledWith(conversation.id)
      expect(listArchivedConversationsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/no archived threads/i)).toBeInTheDocument()
    })
  })

  it('deletes an archived thread after confirmation and invalidates the archived query', async () => {
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
      expect(screen.getByText(/no archived threads/i)).toBeInTheDocument()
    })
  })

  it('keeps archived threads visible when deleting fails after confirmation', async () => {
    const conversation = createArchivedConversation()
    listArchivedConversationsMock.mockResolvedValueOnce([conversation])
    showConfirmMock.mockResolvedValueOnce(true)
    deleteConversationMock.mockRejectedValueOnce(new Error('Delete exploded'))

    renderWithQueryClient(<ArchivedSection />)

    fireEvent.click(await screen.findByTitle('Delete permanently'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Delete exploded')
      expect(screen.getByText('Archived thread')).toBeInTheDocument()
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
      expect(screen.getByText('Archived thread')).toBeInTheDocument()
    })
  })
})
