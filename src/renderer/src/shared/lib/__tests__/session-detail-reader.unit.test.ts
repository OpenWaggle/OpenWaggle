import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionDetailCursor } from '@shared/types/session-transcript-window'
import { describe, expect, it, vi } from 'vitest'
import { createSessionDetailReader } from '../session-detail-reader'

const SESSION = SessionId('session-1')

function message(id: string) {
  return { id: MessageId(id), role: 'assistant' as const, parts: [], createdAt: 1 }
}

function detail(ids: readonly string[], extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SESSION,
    title: 'S',
    projectPath: null,
    messages: ids.map(message),
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  }
}

describe('createSessionDetailReader (D5)', () => {
  it('sends what it holds and completes a delta reply from it, keeping message identity', async () => {
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValueOnce(detail(['a', 'b'], { nodeMutationRevision: 3 }))
      .mockResolvedValueOnce(
        detail(['c'], { nodeMutationRevision: 3, messagesDelta: { baseMessageCount: 2 } }),
      )
    const readDetail = createSessionDetailReader(read)

    const first = await readDetail(SESSION)
    const second = await readDetail(SESSION)

    expect(read.mock.calls[0]?.[1]).toEqual({
      nodeMutationRevision: 0,
      messageCount: 0,
      lastMessageId: null,
    })
    expect(read.mock.calls[1]?.[1]).toEqual({
      nodeMutationRevision: 3,
      messageCount: 2,
      lastMessageId: 'b',
    })
    expect(second?.messages.map((entry) => String(entry.id))).toEqual(['a', 'b', 'c'])
    expect(second?.messages[0]).toBe(first?.messages[0])
    expect(second).not.toHaveProperty('messagesDelta')
  })

  it('reads the whole detail again when a delta continues messages it does not hold', async () => {
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValueOnce(
        detail(['c'], { nodeMutationRevision: 3, messagesDelta: { baseMessageCount: 2 } }),
      )
      .mockResolvedValueOnce(detail(['a', 'b', 'c'], { nodeMutationRevision: 3 }))
    const readDetail = createSessionDetailReader(read)

    const result = await readDetail(SESSION)

    expect(read).toHaveBeenCalledTimes(2)
    expect(result?.messages.map((entry) => String(entry.id))).toEqual(['a', 'b', 'c'])
  })

  it('holds nothing from a Host that sends no revision, so every read is whole', async () => {
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValue(detail(['a']))
    const readDetail = createSessionDetailReader(read)

    await readDetail(SESSION)
    await readDetail(SESSION)

    expect(read.mock.calls[1]?.[1]).toEqual({
      nodeMutationRevision: 0,
      messageCount: 0,
      lastMessageId: null,
    })
  })

  it('forgets a deleted Session', async () => {
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValueOnce(detail(['a'], { nodeMutationRevision: 1 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detail([], { nodeMutationRevision: 1 }))
    const readDetail = createSessionDetailReader(read)

    await readDetail(SESSION)
    await expect(readDetail(SESSION)).resolves.toBeNull()
    await readDetail(SESSION)

    expect(read.mock.calls[2]?.[1]?.messageCount).toBe(0)
  })

  it('keeps one Session’s held messages apart from another’s', async () => {
    const other = SessionId('session-2')
    const read = vi.fn(async (id: SessionId, _cursor?: SessionDetailCursor) =>
      detail([String(id) === 'session-1' ? 'a' : 'z'], { id, nodeMutationRevision: 1 }),
    )
    const readDetail = createSessionDetailReader(read)

    await readDetail(SESSION)
    await readDetail(other)
    await readDetail(SESSION)

    expect(read.mock.calls[2]?.[1]?.lastMessageId).toBe('a')
  })
})
