import { describe, expect, it } from 'vitest'
import type { MessageChatRow } from '../../lib/types-chat-row'
import { buildChatRows, createUserMessage } from './useBuildChatRows.test-utils'

describe('buildChatRows retry status', () => {
  it('replaces stale writing state and stops presenting partial text as streaming', () => {
    const rows = buildChatRows({
      messages: [
        createUserMessage('user-1', 'continue'),
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Partial response' }],
        },
      ],
      isLoading: true,
      error: undefined,
      lastUserMessage: 'continue',
      dismissedError: null,
      sessionId: 'session-retrying',
      waggleMetadataLookup: {},
      phase: {
        current: { label: 'Writing', elapsedMs: 4_000 },
        completed: [],
        totalElapsedMs: 7_000,
      },
      compactionStatus: {
        type: 'retrying',
        attempt: 1,
        maxAttempts: 2,
        delayMs: 2_500,
        errorMessage: 'Provider unavailable',
        previousCompactionStatus: null,
      },
    })

    expect(rows.find((row) => row.type === 'retry-status')).toEqual({
      type: 'retry-status',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 2_500,
    })
    expect(rows.some((row) => row.type === 'phase-indicator')).toBe(false)
    expect(
      rows.find(
        (row): row is MessageChatRow => row.type === 'message' && row.message.id === 'assistant-1',
      )?.isStreaming,
    ).toBe(false)
  })
})
