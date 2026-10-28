import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { sessionDetailView } from '../session-data-view'

function detail(messageCount: number): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'S',
    projectPath: null,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: MessageId(`n${String(index)}`),
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      parts: [{ type: 'text' as const, text: `m${String(index)}` }],
      createdAt: index,
    })),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('bounded to the newest messages (maxMessages, ADR 0036)', () => {
  const ids = (view: SessionDetail | null) => view?.messages.map((message) => String(message.id))

  it('returns only the newest messages of a long Session on a first read', () => {
    const view = sessionDetailView(
      detail(10),
      { nodeMutationRevision: 0, messageCount: 0, lastMessageId: null, maxMessages: 3 },
      2,
    )

    expect(ids(view)).toEqual(['n7', 'n8', 'n9'])
    expect(view?.messagesWindow).toEqual({ startIndex: 7, pathLength: 10 })
    expect(view?.messagesDelta).toBeUndefined()
  })

  it('returns the appended messages when they fit, saying where they start', () => {
    const view = sessionDetailView(
      detail(10),
      { nodeMutationRevision: 2, messageCount: 8, lastMessageId: 'n7', maxMessages: 3 },
      2,
    )

    expect(ids(view)).toEqual(['n8', 'n9'])
    expect(view?.messagesDelta).toEqual({ baseMessageCount: 8 })
    expect(view?.messagesWindow).toEqual({ startIndex: 8, pathLength: 10 })
  })

  it('returns the newest window instead when more were appended than it holds', () => {
    const view = sessionDetailView(
      detail(10),
      { nodeMutationRevision: 2, messageCount: 2, lastMessageId: 'n1', maxMessages: 3 },
      2,
    )

    expect(ids(view)).toEqual(['n7', 'n8', 'n9'])
    expect(view?.messagesDelta).toBeUndefined()
    expect(view?.messagesWindow).toEqual({ startIndex: 7, pathLength: 10 })
  })

  it('bounds a detail the caller does not continue, and one without a revision', () => {
    const moved = sessionDetailView(
      detail(10),
      { nodeMutationRevision: 2, messageCount: 4, lastMessageId: 'elsewhere', maxMessages: 2 },
      2,
    )
    const unrevised = sessionDetailView(
      detail(10),
      { nodeMutationRevision: 0, messageCount: 0, lastMessageId: null, maxMessages: 2 },
      null,
    )

    expect(ids(moved)).toEqual(['n8', 'n9'])
    expect(ids(unrevised)).toEqual(['n8', 'n9'])
    expect(unrevised?.messagesWindow).toEqual({ startIndex: 8, pathLength: 10 })
  })

  it('says a short Session is held whole', () => {
    const view = sessionDetailView(
      detail(2),
      { nodeMutationRevision: 0, messageCount: 0, lastMessageId: null, maxMessages: 400 },
      1,
    )

    expect(ids(view)).toEqual(['n0', 'n1'])
    expect(view?.messagesWindow).toEqual({ startIndex: 0, pathLength: 2 })
  })
})
