import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import {
  isHiddenSessionsToolCall,
  isShownToolCallPart,
  showsOnlyHiddenSessionsToolCalls,
} from '../sessions-tool-visibility'

type Part = UIMessage['parts'][number]

function call(
  name: string,
  args: object,
  state: 'input-streaming' | 'input-complete' = 'input-complete',
): Part {
  return { type: 'tool-call', id: `${name}-1`, name, arguments: JSON.stringify(args), state }
}

const WAIT = call('sessions', { action: 'wait' })

describe('isHiddenSessionsToolCall', () => {
  it('hides only sessions-tool waits', () => {
    expect(isHiddenSessionsToolCall('sessions', { action: 'wait' })).toBe(true)
    expect(isHiddenSessionsToolCall('sessions', { action: 'spawn' })).toBe(false)
    expect(isHiddenSessionsToolCall('wait', { action: 'wait' })).toBe(false)
  })

  it('keeps a streaming call hidden until its action is a whole action name', () => {
    expect(isHiddenSessionsToolCall('sessions', {}, 'input-streaming')).toBe(true)
    // Pi's partial parse yields "w" and "wai" on the way to "wait".
    expect(isHiddenSessionsToolCall('sessions', { action: 'wai' }, 'input-streaming')).toBe(true)
    expect(isHiddenSessionsToolCall('sessions', { action: 'spawn' }, 'input-streaming')).toBe(false)
    expect(isHiddenSessionsToolCall('sessions', {}, 'input-complete')).toBe(false)
  })
})

describe('showsOnlyHiddenSessionsToolCalls', () => {
  it('is true for a message of hidden waits and their results only', () => {
    expect(
      showsOnlyHiddenSessionsToolCalls([
        { type: 'text', content: ' ' },
        WAIT,
        { type: 'tool-result', toolCallId: 'sessions-1', content: 'ok', state: 'output-available' },
      ]),
    ).toBe(true)
  })

  it('is false once anything else would show', () => {
    expect(showsOnlyHiddenSessionsToolCalls([{ type: 'text', content: 'Waiting.' }, WAIT])).toBe(
      false,
    )
    expect(showsOnlyHiddenSessionsToolCalls([WAIT, call('read', {})])).toBe(false)
    expect(showsOnlyHiddenSessionsToolCalls([{ type: 'text', content: '' }])).toBe(false)
  })
})

describe('isShownToolCallPart', () => {
  it('counts every tool call but a hidden wait', () => {
    expect(isShownToolCallPart(WAIT)).toBe(false)
    expect(isShownToolCallPart(call('sessions', { action: 'spawn' }))).toBe(true)
    expect(isShownToolCallPart({ type: 'text', content: 'x' })).toBe(false)
  })
})
