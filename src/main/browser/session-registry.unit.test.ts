import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'

const closeFn = vi.fn().mockResolvedValue(undefined)

vi.mock('./session', () => {
  return {
    BrowserSession: class MockBrowserSession {
      close = closeFn
      isActive = vi.fn().mockReturnValue(false)
    },
  }
})

const { closeAllSessions, closeSession, getOrCreateSession } = await import('./session-registry')

describe('session-registry', () => {
  afterEach(async () => {
    await closeAllSessions()
    closeFn.mockClear()
  })

  it('returns the same session for the same conversation', () => {
    const id = ConversationId('conv-1')
    const session1 = getOrCreateSession(id)
    const session2 = getOrCreateSession(id)
    expect(session1).toBe(session2)
  })

  it('returns different sessions for different conversations', () => {
    const session1 = getOrCreateSession(ConversationId('conv-1'))
    const session2 = getOrCreateSession(ConversationId('conv-2'))
    expect(session1).not.toBe(session2)
  })

  it('closeSession removes the session and calls close', async () => {
    const id = ConversationId('conv-1')
    const session = getOrCreateSession(id)
    await closeSession(id)

    expect(session.close).toHaveBeenCalled()

    // Next call should create a new session
    const newSession = getOrCreateSession(id)
    expect(newSession).not.toBe(session)
  })

  it('closeAllSessions clears all sessions', async () => {
    const s1 = getOrCreateSession(ConversationId('conv-1'))
    getOrCreateSession(ConversationId('conv-2'))

    await closeAllSessions()

    // New sessions should be created
    const s1New = getOrCreateSession(ConversationId('conv-1'))
    expect(s1New).not.toBe(s1)
  })
})
