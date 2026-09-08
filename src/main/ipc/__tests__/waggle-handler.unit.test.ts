import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureSuccessfulRunResourcesMock,
  emitTransportEventMock,
  emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgressMock,
  executeWaggleRunMock,
  getSendHandler,
  inheritedFirstAgentConfig,
  registerWaggleHandlers,
  resetWaggleHandlerMocks,
  SELECTED_MODEL,
  SESSION_ID,
  startStreamBufferMock,
} from './waggle-handler.test-harness'

describe('registerWaggleHandlers', () => {
  beforeEach(resetWaggleHandlerMocks)
  it('starts the Waggle stream buffer with the resolved runtime model for inherited first-agent runs', async () => {
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onRunPrepared?.(SELECTED_MODEL)
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()

    await Effect.runPromise(
      send(
        {},
        SESSION_ID,
        { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )

    expect(executeWaggleRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: SELECTED_MODEL }),
    )
    expect(startStreamBufferMock).toHaveBeenCalledWith(SESSION_ID, SELECTED_MODEL, 'waggle')
    expect(emitTransportEventMock).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ type: 'agent_start', runId: `waggle-${SESSION_ID}` }),
    )
  })

  it('publishes worktree launch progress emitted by a Waggle first send', async () => {
    const progress = {
      stage: 'checking-out-files' as const,
      details: ['Checking out files'],
    }
    executeWaggleRunMock.mockImplementation((input) =>
      Effect.sync(() => {
        input.onWorktreeLaunch?.(progress)
        return { outcome: 'success', newMessages: [] }
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()
    await Effect.runPromise(
      send(
        {},
        SESSION_ID,
        { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )

    expect(emitWorktreeLaunchProgressMock).toHaveBeenCalledWith(SESSION_ID, progress)
  })

  it('captures session resources after a successful Waggle run', async () => {
    const payload = {
      text: 'Review this image',
      thinkingLevel: 'medium' as const,
      attachments: [
        {
          id: 'attachment-1',
          kind: 'image' as const,
          origin: 'user-file' as const,
          name: 'reference.png',
          path: '/tmp/reference.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          extractedText: '',
        },
      ],
    }
    const newMessages = [
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Done' }],
        createdAt: 1,
      },
    ]
    const resourceMessages = [
      {
        id: 'persisted-assistant-message',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Done' }],
        createdAt: 1,
      },
    ]
    executeWaggleRunMock.mockReturnValue(
      Effect.succeed({
        outcome: 'success',
        newMessages,
        resourceMessages,
        resourceNodeIds: {
          'persisted-assistant-message': 'persisted-assistant-node',
        },
        resourceBranchIds: {
          'persisted-assistant-message': 'session-1:main',
        },
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()
    await Effect.runPromise(
      send({}, SESSION_ID, payload, SELECTED_MODEL, inheritedFirstAgentConfig()),
    )

    expect(captureSuccessfulRunResourcesMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: `waggle-${SESSION_ID}`,
      payload,
      messages: resourceMessages,
      nodeIdByMessageId: {
        'persisted-assistant-message': 'persisted-assistant-node',
      },
      branchIdByMessageId: {
        'persisted-assistant-message': 'session-1:main',
      },
    })
  })

  it('captures persisted resources from a partially aborted Waggle run', async () => {
    const resourceMessages = [
      {
        id: 'persisted-partial-message',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: '[Partial docs](https://example.test/docs)' }],
        createdAt: 2,
      },
    ]
    executeWaggleRunMock.mockReturnValue(
      Effect.succeed({
        outcome: 'aborted',
        resourceMessages,
        resourceNodeIds: { 'persisted-partial-message': 'persisted-partial-node' },
        resourceBranchIds: { 'persisted-partial-message': 'session-1:main' },
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()
    await Effect.runPromise(
      send(
        {},
        SESSION_ID,
        { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )

    expect(captureSuccessfulRunResourcesMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: `waggle-${SESSION_ID}`,
      payload: { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
      messages: resourceMessages,
      nodeIdByMessageId: { 'persisted-partial-message': 'persisted-partial-node' },
      branchIdByMessageId: { 'persisted-partial-message': 'session-1:main' },
    })
  })

  it('marks an in-progress Waggle worktree launch as failed when setup is refused', async () => {
    executeWaggleRunMock.mockReturnValue(
      Effect.succeed({
        outcome: 'error',
        message: 'Could not create worktree',
        code: 'worktree-creation-failed',
      }),
    )

    registerWaggleHandlers()
    const send = getSendHandler()
    await Effect.runPromise(
      send(
        {},
        SESSION_ID,
        { text: 'Review this patch', thinkingLevel: 'medium', attachments: [] },
        SELECTED_MODEL,
        inheritedFirstAgentConfig(),
      ),
    )

    expect(emitWorktreeLaunchFailureMock).toHaveBeenCalledWith(
      SESSION_ID,
      'Could not create worktree',
    )
  })
})
