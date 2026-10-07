import { ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { messagePartToUIParts } from '../chat-message-conversion'

describe('messagePartToUIParts', () => {
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
        nestedCalls: [
          { id: 'code-1/1', name: 'read', arguments: '{"path":"a.ts"}', state: 'complete' },
          { id: 'code-1/2', name: 'write', state: 'error', error: 'denied' },
          { id: 'code-1/3', name: 'bash', arguments: '{}', state: 'unfinished' },
        ],
      },
    ])
  })
})
