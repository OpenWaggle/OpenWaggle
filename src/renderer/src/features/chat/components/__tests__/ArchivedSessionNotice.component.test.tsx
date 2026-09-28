import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../state/chat-store'
import { ArchivedSessionNotice } from '../ArchivedSessionNotice'

const { unarchiveSession } = vi.hoisted(() => ({ unarchiveSession: vi.fn(async () => undefined) }))
vi.mock('@/shared/lib/ipc', () => ({ api: { unarchiveSession } }))

function session(archived: boolean): SessionDetail {
  return {
    id: SessionId('worker'),
    title: 'Worker',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...(archived ? { archived: true } : {}),
  }
}

function renderNotice() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchivedSessionNotice />
    </QueryClientProvider>,
  )
}

describe('ArchivedSessionNotice', () => {
  afterEach(() => {
    useChatStore.setState({ activeSession: null })
  })

  it('offers to restore an open session that was archived', async () => {
    useChatStore.setState({ activeSession: session(true) })
    renderNotice()

    expect(screen.getByText(/This session is archived/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    await waitFor(() => expect(unarchiveSession).toHaveBeenCalledWith(SessionId('worker')))
  })

  it('renders nothing for a session that is not archived', () => {
    useChatStore.setState({ activeSession: session(false) })
    const { container } = renderNotice()
    expect(container).toBeEmptyDOMElement()
  })
})
