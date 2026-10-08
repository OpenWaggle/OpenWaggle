import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer-nested')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

function apply(event: AgentTransportEvent) {
  applyEventToStreamBuffer(SESSION_ID, event)
}

function startCodemode() {
  apply({
    type: 'tool_execution_start',
    toolCallId: 'code-1',
    toolName: 'codemode',
    args: {},
    timestamp: 1,
  })
}

function nestedStart(toolCallId: string, parentToolCallId: string, timestamp = 2) {
  apply({
    type: 'tool_execution_start',
    toolCallId,
    toolName: 'read',
    args: { path: 'a.ts' },
    parentToolCallId,
    timestamp,
  })
}

describe('stream buffer nested tool calls', () => {
  beforeEach(() => {
    clearStreamBuffer(SESSION_ID)
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
  })

  afterEach(() => {
    clearStreamBuffer(SESSION_ID)
  })

  it('records nested calls on the calling tool call, never as parts of their own', () => {
    startCodemode()
    nestedStart('code-1/1', 'code-1')
    apply({
      type: 'tool_execution_update',
      toolCallId: 'code-1/1',
      toolName: 'read',
      args: { path: 'a.ts' },
      partialResult: 'partial',
      parentToolCallId: 'code-1',
      timestamp: 3,
    })
    apply({
      type: 'tool_execution_end',
      toolCallId: 'code-1/1',
      toolName: 'read',
      args: { path: 'a.ts' },
      result: 'file contents',
      isError: false,
      parentToolCallId: 'code-1',
      timestamp: 4,
    })
    // A call the nested call made lands in the same list, under the model-issued call.
    nestedStart('code-1/1/1', 'code-1/1', 5)
    apply({
      type: 'tool_execution_end',
      toolCallId: 'code-1/1/1',
      toolName: 'read',
      result: 'missing',
      isError: true,
      parentToolCallId: 'code-1/1',
      timestamp: 6,
    })

    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      {
        type: 'tool-call',
        toolCall: {
          id: 'code-1',
          name: 'codemode',
          args: {},
          state: 'input-complete',
          nestedCalls: {
            calls: [
              { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
              {
                id: 'code-1/1/1',
                name: 'read',
                args: { path: 'a.ts' },
                status: 'error',
                error: 'missing',
              },
            ],
            complete: true,
          },
        },
      },
    ])
  })

  it('marks a running nested call unfinished and drops calls with no known owner', () => {
    startCodemode()
    nestedStart('code-1/1', 'code-1')
    nestedStart('other/1', 'other')

    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      {
        type: 'tool-call',
        toolCall: {
          id: 'code-1',
          name: 'codemode',
          args: {},
          state: 'input-complete',
          nestedCalls: {
            calls: [{ id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'unfinished' }],
            complete: false,
          },
        },
      },
    ])
  })

  function finishNestedCalls(count: number) {
    for (let index = 1; index <= count; index += 1) {
      const toolCallId = `code-1/${String(index)}`
      nestedStart(toolCallId, 'code-1', index)
      apply({
        type: 'tool_execution_end',
        toolCallId,
        toolName: 'read',
        result: 'ok',
        isError: false,
        parentToolCallId: 'code-1',
        timestamp: index,
      })
    }
  }

  function recordedNestedCalls() {
    const part = getStreamBuffer(SESSION_ID)?.parts[0]
    return part?.type === 'tool-call' ? part.toolCall.nestedCalls : undefined
  }

  it('keeps as many calls as Pi does and reports a full list as complete', () => {
    startCodemode()
    finishNestedCalls(NESTED_TOOL_CALL_LIMITS.maxCalls)

    const nestedCalls = recordedNestedCalls()
    expect(nestedCalls?.calls).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(nestedCalls?.complete).toBe(true)
    expect(nestedCalls?.droppedCalls).toBeUndefined()
  })

  it('counts the calls it drops past the cap, including calls they make', () => {
    startCodemode()
    finishNestedCalls(NESTED_TOOL_CALL_LIMITS.maxCalls + 3)
    // A call made by a dropped call still belongs to the codemode call.
    nestedStart(
      `code-1/${String(NESTED_TOOL_CALL_LIMITS.maxCalls + 1)}/1`,
      `code-1/${String(NESTED_TOOL_CALL_LIMITS.maxCalls + 1)}`,
    )

    const nestedCalls = recordedNestedCalls()
    expect(nestedCalls?.calls).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(nestedCalls?.droppedCalls).toBe(4)
    expect(nestedCalls?.complete).toBe(false)
  })
})
