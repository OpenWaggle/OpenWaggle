import { MessageId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeWaggleRuns } from '../active-agent-runs'
import {
  captureSuccessfulRunResourcesMock,
  emitRunCompletedMock,
  executeWaggleRunMock,
  getSendHandler,
  inheritedFirstAgentConfig,
  registerWaggleHandlers,
  resetWaggleHandlerMocks,
  SELECTED_MODEL,
  SESSION_ID,
  typedOnMock,
} from './waggle-handler.test-harness'

describe('Waggle cancellation resource capture', () => {
  beforeEach(resetWaggleHandlerMocks)
  it('finishes cancellation only after partial resource indexing settles', async () => {
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.async((resume) => {
        input.signal.addEventListener(
          'abort',
          () =>
            resume(
              Effect.succeed({
                outcome: 'aborted',
                resourceMessages: [
                  {
                    id: MessageId('partial'),
                    role: 'assistant',
                    createdAt: 1,
                    parts: [{ type: 'text', text: 'Partial output' }],
                  },
                ],
              }),
            ),
          { once: true },
        )
      }),
    )
    let releaseCapture = () => {}
    captureSuccessfulRunResourcesMock.mockReturnValue(
      Effect.async((resume) => {
        releaseCapture = () => resume(Effect.void)
      }),
    )
    registerWaggleHandlers()
    const cancel = typedOnMock.mock.calls.find((call) => call[0] === 'agent:cancel-waggle')?.[1]
    if (typeof cancel !== 'function') throw new Error('Missing Waggle cancellation handler')
    const running = Effect.runPromise(
      getSendHandler()(
        {},
        SESSION_ID,
        { text: 'Review', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )
    await expect.poll(() => activeWaggleRuns.has(SESSION_ID)).toBe(true)
    await Effect.runPromise(cancel({}, SESSION_ID))
    await expect.poll(() => captureSuccessfulRunResourcesMock.mock.calls.length).toBe(1)
    try {
      expect(emitRunCompletedMock).not.toHaveBeenCalled()
      expect(activeWaggleRuns.has(SESSION_ID)).toBe(true)
    } finally {
      releaseCapture()
      await running
    }
    expect(emitRunCompletedMock).toHaveBeenCalledOnce()
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
  })
})
