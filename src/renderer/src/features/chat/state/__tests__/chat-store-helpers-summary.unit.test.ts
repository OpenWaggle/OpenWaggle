import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { toSummary } from '../chat-store-helpers'

function detail(extra: Partial<SessionDetail>): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'Long Session',
    projectPath: null,
    messages: [{ id: MessageId('m-3599'), role: 'assistant', parts: [], createdAt: 1 }],
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  }
}

describe('toSummary', () => {
  it('counts every message of a Session whose detail holds only the newest (ADR 0036)', () => {
    expect(
      toSummary(detail({ messagesWindow: { startIndex: 3_599, pathLength: 3_600 } })).messageCount,
    ).toBe(3_600)
  })

  it('counts the held messages of a detail read whole', () => {
    expect(toSummary(detail({})).messageCount).toBe(1)
  })
})
