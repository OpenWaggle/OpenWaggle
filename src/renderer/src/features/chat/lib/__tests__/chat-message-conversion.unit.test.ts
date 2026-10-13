import { ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { messagePartToUIParts } from '../chat-message-conversion'

describe('messagePartToUIParts', () => {
  it('restores the live nested calls of a running tool call from the active Run buffer', () => {
    const parts = messagePartToUIParts({
      type: 'tool-call',
      toolCall: {
        id: ToolCallId('code-1'),
        name: 'codemode',
        args: {},
        state: 'input-complete',
        nestedCalls: {
          calls: [
            { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
            { id: 'code-1/2', name: 'bash', argsBytes: 9000, status: 'unfinished' },
          ],
          complete: false,
        },
      },
    })

    expect(parts).toEqual([
      {
        type: 'tool-call',
        id: 'code-1',
        name: 'codemode',
        arguments: '{}',
        state: 'input-complete',
        // The active Run buffer's bounded record, completeness and omitted arguments included.
        nestedCalls: {
          calls: [
            { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
            { id: 'code-1/2', name: 'bash', argsBytes: 9000, status: 'unfinished' },
          ],
          complete: false,
        },
      },
    ])
  })

  it('carries the nested calls Pi recorded on a persisted tool result', () => {
    expect(
      messagePartToUIParts({
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('code-1'),
          name: 'codemode',
          args: {},
          result: 'done',
          isError: false,
          duration: 0,
          nestedCalls: {
            complete: false,
            calls: [
              { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
              {
                id: 'code-1/2',
                name: 'write',
                argsBytes: 90_000,
                status: 'error',
                error: 'denied',
              },
              { id: 'code-1/3', name: 'bash', args: {}, status: 'unfinished' },
            ],
          },
        },
      }),
    ).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'code-1',
        content: 'done',
        state: 'complete',
        nestedCalls: {
          complete: false,
          calls: [
            { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
            { id: 'code-1/2', name: 'write', argsBytes: 90_000, status: 'error', error: 'denied' },
            { id: 'code-1/3', name: 'bash', args: {}, status: 'unfinished' },
          ],
        },
      },
    ])
  })
})
