import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../background-run-store'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listActiveRuns: vi.fn(async () => []),
  },
}))

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')

function resetStore() {
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    renderSnapshotsBySessionId: new Map(),
  })
}

function userMessage(id: string, content: string) {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

function assistantTextEvent(messageId: string, delta: string) {
  return {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta,
    },
    timestamp: Date.now(),
  }
}

describe('useBackgroundRunStore', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('applies live render events only to the owning session snapshot', () => {
    useBackgroundRunStore.getState().setRunRenderMessages(SESSION_A, [
      userMessage('user-a', 'Prompt A'),
      {
        id: 'assistant-a',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session A answer' }],
        createdAt: new Date(2),
      },
    ])
    useBackgroundRunStore
      .getState()
      .setRunRenderMessages(SESSION_B, [userMessage('user-b', 'Prompt B')])

    useBackgroundRunStore
      .getState()
      .applyRunRenderEvent(SESSION_B, assistantTextEvent('assistant-b', 'Session B answer'))

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.messages).toEqual([
      userMessage('user-a', 'Prompt A'),
      {
        id: 'assistant-a',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session A answer' }],
        createdAt: new Date(2),
      },
    ])
    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)?.messages).toEqual([
      userMessage('user-b', 'Prompt B'),
      {
        id: 'assistant-b',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session B answer' }],
        createdAt: expect.any(Date),
      },
    ])
  })

  it('does not create a render snapshot from an event without a session-owned seed', () => {
    useBackgroundRunStore
      .getState()
      .setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])

    useBackgroundRunStore
      .getState()
      .applyRunRenderEvent(SESSION_B, assistantTextEvent('assistant-b', 'Session B answer'))

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toBeNull()
    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.messages).toEqual([
      userMessage('user-a', 'Prompt A'),
    ])
  })
})
