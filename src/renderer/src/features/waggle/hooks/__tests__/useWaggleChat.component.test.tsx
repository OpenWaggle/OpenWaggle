import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { WaggleStreamMetadata } from '@shared/types/waggle'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWaggleStore } from '../../state/waggle-store'
import { useWaggleChat } from '../useWaggleChat'

type WaggleTurnPayload = IpcEventChannelMap['waggle:turn-event']['payload']
type WaggleEventPayload = IpcEventChannelMap['waggle:event']['payload']
type RunCompletedPayload = IpcEventChannelMap['agent:run-completed']['payload']
type WaggleTurnHandler = (payload: WaggleTurnPayload) => void
type WaggleEventHandler = (payload: WaggleEventPayload) => void
type RunCompletedHandler = (payload: RunCompletedPayload) => void

const apiMock = vi.hoisted(() => {
  let turnHandler: WaggleTurnHandler | null = null
  let eventHandler: WaggleEventHandler | null = null
  let runCompletedHandler: RunCompletedHandler | null = null
  return {
    turnUnsubscribe: vi.fn(),
    eventUnsubscribe: vi.fn(),
    runCompletedUnsubscribe: vi.fn(),
    getTurnHandler: () => turnHandler,
    getEventHandler: () => eventHandler,
    getRunCompletedHandler: () => runCompletedHandler,
    onWaggleTurnEvent: vi.fn((handler: WaggleTurnHandler) => {
      turnHandler = handler
      return apiMock.turnUnsubscribe
    }),
    onWaggleEvent: vi.fn((handler: WaggleEventHandler) => {
      eventHandler = handler
      return apiMock.eventUnsubscribe
    }),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return apiMock.runCompletedUnsubscribe
    }),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onRunCompleted: apiMock.onRunCompleted,
    onWaggleEvent: apiMock.onWaggleEvent,
    onWaggleTurnEvent: apiMock.onWaggleTurnEvent,
  },
}))

const SESSION_ID = SessionId('session-1')
const OTHER_SESSION_ID = SessionId('session-2')

function waggleMeta(): WaggleStreamMetadata {
  return {
    agentIndex: 1,
    agentLabel: 'Reviewer',
    agentColor: 'amber',
    agentModel: SupportedModelId('openai/gpt-5.5'),
    turnNumber: 2,
    collaborationMode: 'sequential',
    sessionId: String(SESSION_ID),
  }
}

function requireTurnHandler() {
  const handler = apiMock.getTurnHandler()
  if (!handler) throw new Error('Expected Waggle turn handler')
  return handler
}

function requireEventHandler() {
  const handler = apiMock.getEventHandler()
  if (!handler) throw new Error('Expected Waggle event handler')
  return handler
}

function requireRunCompletedHandler() {
  const handler = apiMock.getRunCompletedHandler()
  if (!handler) throw new Error('Expected run-completed handler')
  return handler
}

describe('useWaggleChat', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
    apiMock.turnUnsubscribe.mockClear()
    apiMock.eventUnsubscribe.mockClear()
    apiMock.runCompletedUnsubscribe.mockClear()
    apiMock.onWaggleTurnEvent.mockClear()
    apiMock.onWaggleEvent.mockClear()
    apiMock.onRunCompleted.mockClear()
  })

  it('routes matching Waggle turn events and ignores other sessions', () => {
    const { unmount } = renderHook(() => useWaggleChat(SESSION_ID))
    const turnHandler = requireTurnHandler()

    turnHandler({
      sessionId: OTHER_SESSION_ID,
      event: { type: 'turn-start', turnNumber: 1, agentIndex: 0, agentLabel: 'Ignored' },
    })
    expect(useWaggleStore.getState().currentAgentLabel).toBe('')

    turnHandler({
      sessionId: SESSION_ID,
      event: { type: 'turn-start', turnNumber: 2, agentIndex: 1, agentLabel: 'Reviewer' },
    })

    expect(useWaggleStore.getState().currentAgentLabel).toBe('Reviewer')
    unmount()
    expect(apiMock.turnUnsubscribe).toHaveBeenCalledOnce()
    expect(apiMock.eventUnsubscribe).toHaveBeenCalledOnce()
    expect(apiMock.runCompletedUnsubscribe).toHaveBeenCalledOnce()
  })

  it('tracks assistant message metadata and completes active collaborations from run completion', () => {
    useWaggleStore.setState({ activeCollaborationId: SESSION_ID, status: 'running' })
    renderHook(() => useWaggleChat(null))

    requireEventHandler()({
      sessionId: SESSION_ID,
      event: {
        type: 'message_start',
        messageId: MessageId('m1'),
        role: 'assistant',
      },
      meta: waggleMeta(),
    })
    requireRunCompletedHandler()({ sessionId: SESSION_ID })

    expect(useWaggleStore.getState().liveMessageMetadata.m1?.agentLabel).toBe('Reviewer')
    expect(useWaggleStore.getState().status).toBe('completed')
  })
})
