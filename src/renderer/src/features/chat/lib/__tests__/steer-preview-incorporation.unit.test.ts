import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import type { OptimisticSteerPreview } from '../../state/optimistic-steer-store'
import { withIncorporatedPreview } from '../steer-preview-incorporation'
import { insertOptimisticSteeredUserTurn } from '../steer-preview-matching'

function row(id: string, role: UIMessage['role'], content: string, at: number, order?: number) {
  const message: UIMessage = {
    id,
    role,
    parts: [{ type: 'text', content }],
    createdAt: new Date(at),
    ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
  }
  return message
}

function preview(id: string, at: number): OptimisticSteerPreview {
  return {
    id,
    content: 'continue',
    incorporatedContent: { text: 'continue', attachmentCount: 0 },
    durableContent: 'continue',
    receipt: null,
    baselineUserMessageIds: new Set(['u1']),
    baselineMaxCreatedOrder: 2,
    message: row(`optimistic-steer-${id}`, 'user', 'continue', at),
  }
}

describe('withIncorporatedPreview', () => {
  // Two promoted steers with the same text, both waiting when Pi takes in the first one (X).
  const x = row('live-x', 'user', 'continue', 1200, 5)
  const transcript = [
    row('u1', 'user', 'Fix', 0, 1),
    row('a1', 'assistant', 'reading', 500),
    x,
    row('a2', 'assistant', 'answer to the first continue', 1300),
  ]

  it('gives a row seen again (a reconnect re-reading the buffer) to no second preview', () => {
    const live = withIncorporatedPreview([preview('p1', 1000), preview('p2', 1100)], x)
    const reread = withIncorporatedPreview(live, x)
    expect(reread.map((turn) => turn.incorporatedAt)).toEqual([1200, undefined])
    expect(insertOptimisticSteeredUserTurn(transcript, reread).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'live-x',
      'a2',
      'optimistic-steer-p2',
    ])
    const lost = transcript.filter((message) => message.id !== 'live-x')
    expect(insertOptimisticSteeredUserTurn(lost, reread).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'optimistic-steer-p1',
      'a2',
      'optimistic-steer-p2',
    ])
  })

  it('takes no row before a queued receipt boundary', () => {
    const queued: OptimisticSteerPreview = {
      ...preview('p1', 1000),
      receipt: { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: 6 },
    }
    expect(withIncorporatedPreview([queued], x)[0]?.incorporatedAt).toBeUndefined()
  })

  it('keeps a preview whose row was lost from taking the next steer with its text', () => {
    // P1's row X left the transcript (rebuilt from a detail without it); P2's row Y then arrives.
    const [p1, p2] = withIncorporatedPreview([preview('p1', 1000), preview('p2', 1100)], x)
    const y = row('live-y', 'user', 'continue', 1400, 7)
    const shown = [...transcript.filter((message) => message.id !== 'live-x'), y]
    expect(
      insertOptimisticSteeredUserTurn(
        shown,
        [p1, p2].filter((turn) => turn !== undefined),
      ).map((message) => message.id),
    ).toEqual(['u1', 'a1', 'optimistic-steer-p1', 'a2', 'live-y'])
  })

  it('gives a row to no preview promoted before one recorded at a lower log order', () => {
    const later: OptimisticSteerPreview = {
      ...preview('p2', 1100),
      incorporatedAt: 1200,
      incorporatedRowId: 'live-x',
      incorporatedOrder: 5,
    }
    const y = row('live-y', 'user', 'continue', 1400, 7)
    const noted = withIncorporatedPreview([preview('p1', 1000), later], y)
    expect(noted[0]?.incorporatedRowId).toBeUndefined()
  })
})
