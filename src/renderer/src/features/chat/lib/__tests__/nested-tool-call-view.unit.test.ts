import type { NestedToolCalls } from '@shared/types/tools'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
import { describe, expect, it } from 'vitest'
import { nestedToolCallCard, nestedToolCallsView } from '../nested-tool-call-view'

const record: NestedToolCalls = {
  calls: [
    { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
    { id: 'code-1/2', name: 'write', argsBytes: 90_000, status: 'error', error: 'denied' },
    { id: 'code-1/3', name: 'bash', args: {}, status: 'unfinished' },
  ],
  complete: false,
}

function fullRecord(extra: Partial<NestedToolCalls> = {}): NestedToolCalls {
  return {
    calls: Array.from({ length: NESTED_TOOL_CALL_LIMITS.maxCalls }, (_, index) => ({
      id: `code-1/${String(index + 1)}`,
      name: 'read',
      args: {},
      status: 'ok' as const,
    })),
    complete: false,
    ...extra,
  }
}

describe('nestedToolCallsView', () => {
  it('shows an unfinished call as running until the calling tool finishes', () => {
    expect(nestedToolCallsView(record, undefined, false).calls.map((call) => call.state)).toEqual([
      'complete',
      'error',
      'executing',
    ])
    expect(nestedToolCallsView(record, undefined, true).calls.map((call) => call.state)).toEqual([
      'complete',
      'error',
      'unfinished',
    ])
  })

  it('leaves out Worker waits, so the list and its frame match what shows', () => {
    const waits: NestedToolCalls = {
      calls: [
        { id: 'code-1/1', name: 'hive', args: { action: 'wait' }, status: 'ok' },
        { id: 'code-1/2', name: 'hive', args: { action: 'spawn' }, status: 'ok' },
      ],
      complete: true,
    }
    expect(nestedToolCallsView(waits, undefined, true).calls.map((call) => call.id)).toEqual([
      'code-1/2',
    ])
  })

  it('prefers the live record and falls back to the persisted one', () => {
    const persisted: NestedToolCalls = {
      calls: [{ id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' }],
      complete: true,
    }

    expect(nestedToolCallsView(undefined, persisted, true).calls).toHaveLength(1)
    expect(nestedToolCallsView(record, persisted, true).calls).toHaveLength(3)
    expect(nestedToolCallsView(undefined, undefined, true)).toEqual({
      calls: [],
      omittedCalls: null,
    })
  })

  it('keeps arguments Pi left out apart from empty arguments', () => {
    const [read, write, bash] = nestedToolCallsView(record, undefined, true).calls

    expect(read).toMatchObject({ arguments: '{"path":"a.ts"}', argumentsOmitted: false })
    expect(write).toMatchObject({ argumentsOmitted: true })
    expect(write).not.toHaveProperty('arguments')
    expect(bash).toMatchObject({ arguments: '{}', argumentsOmitted: false })
  })

  it('says how many calls the live record dropped', () => {
    expect(
      nestedToolCallsView(fullRecord({ droppedCalls: 1 }), undefined, false).omittedCalls,
    ).toBe('1 more tool call not shown')
    expect(
      nestedToolCallsView(fullRecord({ droppedCalls: 7 }), undefined, false).omittedCalls,
    ).toBe('7 more tool calls not shown')
  })

  it("says calls were dropped from Pi's full, incomplete record without a count", () => {
    expect(nestedToolCallsView(undefined, fullRecord(), true).omittedCalls).toBe(
      'More tool calls not shown',
    )
    expect(nestedToolCallsView(undefined, fullRecord({ complete: true }), true).omittedCalls).toBe(
      null,
    )
    // Incomplete because of omitted arguments or unfinished calls, not dropped calls.
    expect(nestedToolCallsView(undefined, record, true).omittedCalls).toBe(null)
  })
})

describe('nestedToolCallCard', () => {
  it("renders Pi's recorded error and no result for a call still running", () => {
    const [read, write, bash] = nestedToolCallsView(record, undefined, false).calls

    expect(read && nestedToolCallCard(read).result).toEqual({ content: '', state: 'complete' })
    expect(write && nestedToolCallCard(write)).toMatchObject({
      args: '{}',
      result: { content: 'denied', state: 'error', error: 'denied' },
    })
    expect(bash && nestedToolCallCard(bash).result).toBeUndefined()
  })
})
