import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import {
  isHiddenSessionsToolCall,
  isHiddenSessionsToolCallJson,
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
    expect(isHiddenSessionsToolCallJson('sessions', '{}', 'input-complete', false)).toBe(true)
  })
})

describe('isHiddenSessionsToolCallJson', () => {
  it('reads the action of a preview cut short, as a script call list records it', () => {
    const ids = Array.from(
      { length: 8 },
      (_, index) => `00000000-0000-0000-0000-00000000000${index}`,
    )
    const preview = `${JSON.stringify({ action: 'wait', sessionIds: ids }).slice(0, 200)}...`
    expect(isHiddenSessionsToolCallJson('sessions', preview)).toBe(true)
    expect(isHiddenSessionsToolCallJson('sessions', '{"action":"spawn","objective":"x')).toBe(false)
    expect(isHiddenSessionsToolCallJson('read', preview)).toBe(false)
    // Keys keep the script's order, so the cut can come before or after the action.
    const late = `${JSON.stringify({ sessionIds: ids.slice(0, 3), action: 'wait', timeoutMs: 1 }).slice(0, 180)}...`
    expect(isHiddenSessionsToolCallJson('sessions', late)).toBe(true)
    const cutBeforeAction = `${JSON.stringify({ sessionIds: ids, action: 'wait' }).slice(0, 200)}...`
    expect(cutBeforeAction).not.toContain('"action"')
    expect(isHiddenSessionsToolCallJson('sessions', cutBeforeAction)).toBe(true)
  })

  it('keeps a streaming name hidden while it is still the start of another action', () => {
    expect(
      isHiddenSessionsToolCallJson('sessions', '{"action":"delegation_s"}', 'input-streaming'),
    ).toBe(true)
    expect(isHiddenSessionsToolCallJson('sessions', '{"action":"export"}', 'input-streaming')).toBe(
      true,
    )
    expect(isHiddenSessionsToolCallJson('sessions', '{"action":"export"}', 'input-complete')).toBe(
      false,
    )
    expect(
      isHiddenSessionsToolCallJson('sessions', '{"action":"delegation_claim"}', 'input-streaming'),
    ).toBe(false)
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
    expect(isShownToolCallPart(WAIT, [WAIT])).toBe(false)
    const spawn = call('sessions', { action: 'spawn' })
    expect(isShownToolCallPart(spawn, [spawn])).toBe(true)
    expect(isShownToolCallPart({ type: 'text', content: 'x' }, [])).toBe(false)
  })

  it('hides an action-less call until it has a result, as a reconnect may mark it complete', () => {
    const empty = call('sessions', {})
    expect(isShownToolCallPart(empty, [empty])).toBe(false)
    const answered: Part = {
      type: 'tool-result',
      toolCallId: empty.type === 'tool-call' ? empty.id : '',
      content: 'err',
      state: 'error',
    }
    expect(isShownToolCallPart(empty, [empty, answered])).toBe(true)
  })
})
