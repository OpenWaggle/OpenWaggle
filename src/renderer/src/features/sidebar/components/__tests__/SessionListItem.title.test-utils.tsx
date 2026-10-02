import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { SessionListItem } from '../SessionListItem'

export const TITLE_SESSION_ID = SessionId('session-title-1')
export const ORIGINAL_TITLE = 'Fix the flaky login test'
export const ORIGINAL_UPDATED_AT = 2

export function titleSession() {
  return {
    id: TITLE_SESSION_ID,
    title: ORIGINAL_TITLE,
    projectPath: '/repo',
    messageCount: 4,
    createdAt: 1,
    updatedAt: ORIGINAL_UPDATED_AT,
  } satisfies SessionSummary
}

/** Seed both renderer stores that hold the Session's title, as the running app does. */
export function seedTitleStores() {
  const session = titleSession()
  useSessionStore.setState({ sessions: [session], activeSessionTree: null, activeWorkspace: null })
  useChatStore.setState({ sessions: [session], sessionById: new Map() })
}

/** The row reads its Session from the store, so optimistic and reverted titles render. */
function StoreBackedRow() {
  const session = useSessionStore((state) =>
    state.sessions.find((candidate) => candidate.id === TITLE_SESSION_ID),
  )
  if (!session) return null
  return (
    <SessionListItem
      session={session}
      isActive={false}
      actions={{
        select: vi.fn(),
        delete: vi.fn(),
        archive: vi.fn(),
        clone: vi.fn(),
        markUnread: vi.fn(),
        togglePin: vi.fn(),
      }}
    />
  )
}

export function renderStoreBackedRow() {
  render(
    <ul>
      <StoreBackedRow />
    </ul>,
  )
}

export function storedTitles() {
  return {
    sidebar: useSessionStore.getState().sessions[0]?.title,
    chat: useChatStore.getState().sessions[0]?.title,
    updatedAt: useSessionStore.getState().sessions[0]?.updatedAt,
  }
}
