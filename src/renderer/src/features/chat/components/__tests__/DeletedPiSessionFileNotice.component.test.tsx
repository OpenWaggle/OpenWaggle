import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../state/chat-store'
import { DeletedPiSessionFileNotice } from '../DeletedPiSessionFileNotice'

const DELETED =
  "This Session's Pi session file was deleted outside OpenWaggle (/p/s.jsonl), so its history is gone and it cannot be continued. Restore the file to continue it. The Session stays, to read, because fork f1 still depends on it."

function session(piSessionFileDeleted?: string): SessionDetail {
  return {
    id: SessionId('discovered'),
    title: 'Discovered',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...(piSessionFileDeleted ? { piSessionFileDeleted } : {}),
  }
}

describe('DeletedPiSessionFileNotice', () => {
  afterEach(() => {
    useChatStore.setState({ activeSession: null })
  })

  it('says why an opened Session whose Pi file was deleted cannot be continued', () => {
    useChatStore.setState({ activeSession: session(DELETED) })
    render(<DeletedPiSessionFileNotice />)

    expect(screen.getByRole('status')).toHaveTextContent(DELETED)
  })

  it('renders nothing while the file is there', () => {
    useChatStore.setState({ activeSession: session() })
    const { container } = render(<DeletedPiSessionFileNotice />)

    expect(container).toBeEmptyDOMElement()
  })
})
