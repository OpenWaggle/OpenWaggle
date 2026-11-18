import type { JsonValue } from '@shared/types/json'
import type { NestedToolCalls } from '@shared/types/tools'
import { describe, expect, it } from 'vitest'
import {
  mergeNestedToolCalls,
  NESTED_TOOL_CALL_LIMITS,
  type NestedToolExecutionEvent,
  ownsNestedToolCall,
  recordNestedToolExecution,
} from '../nested-tool-calls'

function start(toolCallId: string, args: NestedToolExecutionEvent['args'] = {}) {
  return {
    type: 'tool_execution_start',
    toolCallId,
    toolName: 'read',
    args,
    timestamp: 1,
  } as const satisfies NestedToolExecutionEvent
}

function end(toolCallId: string, isError = false, result: JsonValue = 'ok') {
  return {
    type: 'tool_execution_end',
    toolCallId,
    toolName: 'read',
    result,
    isError,
    timestamp: 2,
  } as const satisfies NestedToolExecutionEvent
}

function record(events: readonly NestedToolExecutionEvent[]) {
  return events.reduce<NestedToolCalls | undefined>(recordNestedToolExecution, undefined)
}

function finishedCalls(count: number) {
  return Array.from({ length: count }, (_, index) => [
    start(`code-1/${String(index + 1)}`),
    end(`code-1/${String(index + 1)}`),
  ]).flat()
}

describe('recordNestedToolExecution', () => {
  it('keeps the arguments a call started with and no result, like Pi', () => {
    expect(
      record([
        start('code-1/1', { path: 'a.ts' }),
        {
          type: 'tool_execution_update',
          toolCallId: 'code-1/1',
          toolName: 'read',
          args: { path: 'changed.ts' },
          partialResult: 'partial',
          timestamp: 2,
        },
        end('code-1/1'),
        start('code-1/2', { path: 'b.ts' }),
        end('code-1/2', true, { content: [{ type: 'text', text: 'missing' }] }),
      ]),
    ).toEqual({
      calls: [
        { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
        { id: 'code-1/2', name: 'read', args: { path: 'b.ts' }, status: 'error', error: 'missing' },
      ],
      complete: true,
    })
  })

  it('is incomplete while a call runs', () => {
    expect(record([start('code-1/1')])).toEqual({
      calls: [{ id: 'code-1/1', name: 'read', args: {}, status: 'unfinished' }],
      complete: false,
    })
  })

  it('treats exactly the maximum number of finished calls as complete', () => {
    const result = record(finishedCalls(NESTED_TOOL_CALL_LIMITS.maxCalls))

    expect(result?.calls).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(result?.complete).toBe(true)
    expect(result).not.toHaveProperty('droppedCalls')
  })

  it('counts the calls it drops past the maximum, once each', () => {
    const result = record(finishedCalls(NESTED_TOOL_CALL_LIMITS.maxCalls + 3))

    expect(result?.calls).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(result?.droppedCalls).toBe(3)
    expect(result?.complete).toBe(false)
  })

  it('leaves out arguments over the per-call and total sizes', () => {
    const big = { text: 'x'.repeat(NESTED_TOOL_CALL_LIMITS.maxArgumentBytesPerCall) }
    const medium = { text: 'y'.repeat(8000) }
    const result = record([
      start('code-1/1', big),
      end('code-1/1'),
      ...Array.from({ length: 5 }, (_, index) => [
        start(`code-1/${String(index + 2)}`, medium),
        end(`code-1/${String(index + 2)}`),
      ]).flat(),
    ])

    const [first, ...rest] = result?.calls ?? []
    expect(first).toEqual({
      id: 'code-1/1',
      name: 'read',
      argsBytes: JSON.stringify(big).length,
      status: 'ok',
    })
    // The total allows four calls of this size; the fifth loses its arguments.
    expect(rest.map((call) => call.args !== undefined)).toEqual([true, true, true, true, false])
    expect(rest[4]?.argsBytes).toBe(JSON.stringify(medium).length)
    expect(result?.complete).toBe(false)
  })

  it('truncates error text', () => {
    const result = record([start('code-1/1'), end('code-1/1', true, 'e'.repeat(2000))])

    expect(result?.calls[0]?.error).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxErrorChars)
  })
})

describe('ownsNestedToolCall', () => {
  it('owns calls made by itself, by its nested calls, and by calls it dropped', () => {
    expect(ownsNestedToolCall('code-1', undefined, 'code-1')).toBe(true)
    expect(ownsNestedToolCall('code-1', undefined, 'code-1/300')).toBe(true)
    expect(ownsNestedToolCall('code-1', undefined, 'code-10')).toBe(false)
    expect(
      ownsNestedToolCall(
        'code-1',
        { calls: [{ id: 'other/1', name: 'read', status: 'ok' }], complete: true },
        'other/1',
      ),
    ).toBe(true)
  })
})

describe('mergeNestedToolCalls', () => {
  const ok = { id: 'c/1', name: 'read', args: {}, status: 'ok' } as const
  const running = { id: 'c/1', name: 'read', args: {}, status: 'unfinished' } as const
  const failed = { id: 'c/2', name: 'bash', args: {}, status: 'error', error: 'boom' } as const

  it('keeps each call once, in its finished state, from whichever copy saw it finish', () => {
    expect(
      mergeNestedToolCalls(
        { calls: [running], complete: false },
        { calls: [ok, failed], complete: true },
      ),
    ).toEqual({ calls: [ok, failed], complete: true })
    expect(
      mergeNestedToolCalls(
        { calls: [ok, failed], complete: true },
        { calls: [running], complete: false },
      ),
    ).toEqual({ calls: [ok, failed], complete: true })
  })

  it('keeps the larger count of dropped calls, and is incomplete with any', () => {
    expect(
      mergeNestedToolCalls(
        { calls: [ok], complete: false, droppedCalls: 2 },
        { calls: [ok], complete: false, droppedCalls: 5 },
      ),
    ).toEqual({ calls: [ok], complete: false, droppedCalls: 5 })
  })

  it("stays incomplete when Pi's record dropped calls it did not count", () => {
    // Every call finished with its arguments, yet Pi marked the record incomplete: it dropped some.
    expect(
      mergeNestedToolCalls({ calls: [ok], complete: false }, { calls: [ok], complete: true }),
    ).toEqual({ calls: [ok], complete: false })
  })

  it('returns the other record when one side has none', () => {
    const record = { calls: [ok], complete: true }

    expect(mergeNestedToolCalls(undefined, record)).toBe(record)
    expect(mergeNestedToolCalls(record, undefined)).toBe(record)
  })
})
