import { SessionId, SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  broadcastToWindowsMock,
  captureSuccessfulRunResourcesMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitErrorAndFinishMock,
  emitRunCompletedMock,
  emitTransportEventMock,
  emitWaggleTransportEventMock,
  emitWaggleTurnEventMock,
  emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgressMock,
  executeWaggleRunMock,
  startStreamBufferMock,
  typedHandleMock,
  typedOnMock,
} = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
  captureSuccessfulRunResourcesMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitErrorAndFinishMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  emitTransportEventMock: vi.fn(),
  emitWaggleTransportEventMock: vi.fn(),
  emitWaggleTurnEventMock: vi.fn(),
  emitWorktreeLaunchFailureMock: vi.fn(),
  emitWorktreeLaunchProgressMock: vi.fn(),
  executeWaggleRunMock: vi.fn(),
  startStreamBufferMock: vi.fn(),
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../application/waggle-run-service', () => ({
  executeWaggleRun: executeWaggleRunMock,
}))

vi.mock('../../application/session-resource-capture', () => ({
  captureSuccessfulRunResources: captureSuccessfulRunResourcesMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: clearAgentPhaseMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitErrorAndFinish: emitErrorAndFinishMock,
  emitRunCompleted: emitRunCompletedMock,
  emitTransportEvent: emitTransportEventMock,
  emitWaggleTransportEvent: emitWaggleTransportEventMock,
  emitWaggleTurnEvent: emitWaggleTurnEventMock,
  emitWorktreeLaunchFailure: emitWorktreeLaunchFailureMock,
  emitWorktreeLaunchProgress: emitWorktreeLaunchProgressMock,
  startStreamBuffer: startStreamBufferMock,
}))

import { cancelAllSessionRuns } from '../active-agent-runs'
import { registerWaggleHandlers } from '../waggle-handler'

const SESSION_ID = SessionId('session-1')
const SELECTED_MODEL = SupportedModelId('openai/gpt-5.4')

function inheritedFirstAgentConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4-5'),
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}

function getSendHandler() {
  const call = typedHandleMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === 'agent:send-waggle-message',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:send-waggle-message handler to be registered')
  }
  return handler
}

describe('registerWaggleHandlers', () => {
  beforeEach(() => {
    cancelAllSessionRuns()
    broadcastToWindowsMock.mockReset()
    captureSuccessfulRunResourcesMock.mockReset()
    captureSuccessfulRunResourcesMock.mockReturnValue(Effect.void)
    clearAgentPhaseMock.mockReset()
    clearStreamBufferMock.mockReset()
    emitErrorAndFinishMock.mockReset()
    emitRunCompletedMock.mockReset()
    emitTransportEventMock.mockReset()
    emitWaggleTransportEventMock.mockReset()
    emitWaggleTurnEventMock.mockReset()
    emitWorktreeLaunchFailureMock.mockReset()
    emitWorktreeLaunchProgressMock.mockReset()
    executeWaggleRunMock.mockReset()
    startStreamBufferMock.mockReset()
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
  })

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
    executeWaggleRunMock.mockReturnValue(Effect.succeed({ outcome: 'success', newMessages }))

    registerWaggleHandlers()
    const send = getSendHandler()
    await Effect.runPromise(
      send({}, SESSION_ID, payload, SELECTED_MODEL, inheritedFirstAgentConfig()),
    )

    expect(captureSuccessfulRunResourcesMock).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: `waggle-${SESSION_ID}`,
      payload,
      messages: newMessages,
      nodeIdByMessageId: {},
      branchIdByMessageId: {},
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
