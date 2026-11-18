import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepositoryError } from '../../errors'
import {
  getSessionResourceHandlerMocks,
  invokeSessionResourceHandler as invoke,
  resetSessionResourceHandlerHarness,
} from './session-resource-handler.test-harness'

const handlerMocks = getSessionResourceHandlerMocks()

describe('session resource IPC backfill failure', () => {
  beforeEach(() => {
    resetSessionResourceHandlerHarness()
  })

  it('does not advance the page cursor after tool metadata persistence fails', async () => {
    handlerMocks.listResourceProjectionPage.mockReturnValue({
      nodes: [
        {
          id: 'assistant-node',
          branchId: 'session-one:main',
          message: {
            id: 'assistant-message',
            role: 'assistant',
            parts: [
              {
                type: 'tool-result',
                toolResult: {
                  id: 'tool-call-one',
                  name: 'read',
                  args: { path: 'src/session-summary.ts' },
                  result: 'file contents',
                  isError: false,
                  duration: 1,
                },
              },
            ],
            createdAt: 1000,
          },
        },
      ],
      throughCreatedOrder: 41,
      hasMore: false,
    })
    handlerMocks.upsert.mockReturnValue(
      new SessionResourceRepositoryError({
        operation: 'upsert',
        cause: new Error('database temporarily unavailable'),
      }),
    )

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
      progressed: false,
    })

    expect(handlerMocks.advanceBackfillCursor).not.toHaveBeenCalled()
  })
})
