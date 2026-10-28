import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionDetailCursor } from '@shared/types/session-transcript-window'
import { describe, expect, it, vi } from 'vitest'
import { createSessionDetailReader, SESSION_DETAIL_MESSAGE_WINDOW } from '../session-detail-reader'

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
      maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
    })
    expect(read.mock.calls[1]?.[1]).toEqual({
      nodeMutationRevision: 3,
      messageCount: 2,
      lastMessageId: 'b',
      maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
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
      maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
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

  it('holds the newest window of a long Session and names where it starts (ADR 0036)', async () => {
    const ids = Array.from({ length: 3 }, (_, index) => `m${String(index + 3_597)}`)
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValueOnce(
        detail(ids, {
          nodeMutationRevision: 2,
          messagesWindow: { startIndex: 3_597, pathLength: 3_600 },
        }),
      )
      .mockResolvedValueOnce(
        detail(['m3600'], {
          nodeMutationRevision: 2,
          messagesDelta: { baseMessageCount: 3_600 },
          messagesWindow: { startIndex: 3_600, pathLength: 3_601 },
        }),
      )
    const readDetail = createSessionDetailReader(read)

    const first = await readDetail(SESSION)
    const second = await readDetail(SESSION)

    expect(first?.messagesWindow).toEqual({ startIndex: 3_597, pathLength: 3_600 })
    expect(read.mock.calls[1]?.[1]).toEqual({
      nodeMutationRevision: 2,
      messageCount: 3_600,
      lastMessageId: 'm3599',
      maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
    })
    expect(second?.messages.map((entry) => String(entry.id))).toEqual([
      'm3597',
      'm3598',
      'm3599',
      'm3600',
    ])
    expect(second?.messagesWindow).toEqual({ startIndex: 3_597, pathLength: 3_601 })
    expect(second).not.toHaveProperty('messagesDelta')
  })

  it('keeps no more than its window when appended messages push older ones out', async () => {
    const held = Array.from(
      { length: SESSION_DETAIL_MESSAGE_WINDOW },
      (_, index) => `h${String(index)}`,
    )
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockResolvedValueOnce(detail(held, { nodeMutationRevision: 1 }))
      .mockResolvedValueOnce(
        detail(['new-1', 'new-2'], {
          nodeMutationRevision: 1,
          messagesDelta: { baseMessageCount: SESSION_DETAIL_MESSAGE_WINDOW },
        }),
      )
    const readDetail = createSessionDetailReader(read)

    const first = await readDetail(SESSION)
    const result = await readDetail(SESSION)

    expect(result?.messages).toHaveLength(SESSION_DETAIL_MESSAGE_WINDOW)
    expect(result?.messages.at(-1)?.id).toBe('new-2')
    expect(result?.messages[0]).toBe(first?.messages[2])
    expect(result?.messagesWindow).toEqual({
      startIndex: 2,
      pathLength: SESSION_DETAIL_MESSAGE_WINDOW + 2,
    })
  })

  it('runs a read asked for during another after it, sharing one read and its cursor', async () => {
    let finishFirst: (value: SessionDetail) => void = () => {}
    const read = vi
      .fn<(id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce(
        detail([], { nodeMutationRevision: 5, messagesDelta: { baseMessageCount: 2 } }),
      )
    const readDetail = createSessionDetailReader(read)

    const opening = readDetail(SESSION)
    const refreshA = readDetail(SESSION)
    const refreshB = readDetail(SESSION)
    expect(read).toHaveBeenCalledTimes(1)
    finishFirst(detail(['a', 'b'], { nodeMutationRevision: 5 }))
    const [first, second, third] = await Promise.all([opening, refreshA, refreshB])

    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]?.[1]?.messageCount).toBe(2)
    expect(second).toBe(third)
    expect(second?.messages[1]).toBe(first?.messages[1])
  })
})
