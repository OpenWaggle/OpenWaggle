import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { answerContentKey, withoutSavedRunAnswers } from '../saved-run-answers'

/*
 * A streamed answer and its saved copy split their text differently: the live view joins two text
 * blocks in a row that Pi saves as two parts, and an empty thought may sit between them. Matched by
 * content, the two must still be one answer.
 */

const answer = (id: string, parts: UIMessage['parts'], order?: number): UIMessage => ({
  id,
  role: 'assistant',
  parts,
  ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
})
const text = (content: string) => ({ type: 'text' as const, content })
const tool = (id: string) => ({
  type: 'tool-call' as const,
  id,
  name: 'bash',
  arguments: '{}',
  state: 'complete',
})

describe('answerContentKey', () => {
  it('reads the text between tool calls as one, however it is split', () => {
    const joined = answerContentKey(answer('live', [text('Plan. Then report')]))
    expect(answerContentKey(answer('saved', [text('Plan. '), text('Then report')]))).toBe(joined)
    expect(
      answerContentKey(
        answer('saved', [text('Plan. '), { type: 'thinking', content: '' }, text('Then report')]),
      ),
    ).toBe(joined)
  })

  it('still tells texts apart across a tool call', () => {
    expect(answerContentKey(answer('a', [text('Plan.'), tool('c1'), text('Done')]))).not.toBe(
      answerContentKey(answer('b', [text('Plan.Done'), tool('c1')])),
    )
  })

  it('leaves a streamed answer to its saved copy split in two parts', () => {
    const user: UIMessage = {
      id: 'n-u1',
      role: 'user',
      parts: [text('Fix it')],
      metadata: { sessionNodeCreatedOrder: 1 },
    }
    const saved = [user, answer('n-a1', [text('report back'), text('report back')], 2)]
    const shown = [user, answer('stream-a1', [text('report backreport back')])]
    expect(withoutSavedRunAnswers(shown, saved, { fromOrder: 1 }).map((m) => m.id)).toEqual([
      'n-u1',
    ])
  })
})
