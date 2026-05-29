import { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '@/features/waggle/state'
import { useWaggleMetadataLookup } from '../useWaggleMetadataLookup'
import {
  makeAssistantMessage,
  makeConfig,
  makeProjectedSession,
  makeSessionDetail,
  makeUserMessage,
} from './useWaggleMetadataLookup.test-utils'

describe('useWaggleMetadataLookup', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
  })

  it('returns equivalent metadata when inputs and waggle state are unchanged', () => {
    const config = makeConfig()
    const metadata: WaggleMessageMetadata = {
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: SupportedModelId('claude-sonnet-4-5'),
      turnNumber: 0,
    }
    const session = makeSessionDetail(config, metadata)
    const messages = [makeAssistantMessage('assistant-1')]

    const { result, rerender } = renderHook(
      ({
        currentSession,
        currentMessages,
      }: {
        currentSession: SessionDetail | null
        currentMessages: UIMessage[]
      }) => useWaggleMetadataLookup(currentSession, currentMessages),
      { initialProps: { currentSession: session, currentMessages: messages } },
    )

    const firstLookup = result.current
    rerender({ currentSession: session, currentMessages: messages })

    expect(result.current).toStrictEqual(firstLookup)
    expect(result.current['assistant-1']).toEqual(metadata)
  })

  it('returns a new lookup when live waggle state changes', () => {
    const config = makeConfig()
    const session = makeSessionDetail(config)
    const messages = [
      makeAssistantMessage('ui-assistant-1'),
      makeAssistantMessage('ui-assistant-2'),
    ]

    const { result, rerender } = renderHook(
      ({
        currentSession,
        currentMessages,
      }: {
        currentSession: SessionDetail | null
        currentMessages: UIMessage[]
      }) => useWaggleMetadataLookup(currentSession, currentMessages),
      { initialProps: { currentSession: session, currentMessages: messages } },
    )

    const initialLookup = result.current
    useWaggleStore.setState({
      activeConfig: config,
      status: 'running',
      completedTurnMeta: [
        {
          agentIndex: 0,
          agentLabel: 'Architect',
          agentColor: 'blue',
          agentModel: SupportedModelId('claude-sonnet-4-5'),
          turnNumber: 0,
        },
      ],
      currentAgentIndex: 1,
      currentAgentLabel: 'Reviewer',
    })
    rerender({ currentSession: session, currentMessages: messages })

    expect(result.current).not.toBe(initialLookup)
    expect(result.current['ui-assistant-2']).toMatchObject({
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
    })
  })

  it('prefers live message metadata over assistant-position fallback during streaming', () => {
    const config = makeConfig()
    const session = makeSessionDetail(config)
    const messages = [makeAssistantMessage('ui-assistant-live')]

    useWaggleStore.setState({
      activeConfig: config,
      status: 'running',
      completedTurnMeta: [],
      initialTurnMeta: {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 0,
      },
      liveMessageMetadata: {
        'ui-assistant-live': {
          agentIndex: 1,
          agentLabel: 'Reviewer',
          agentColor: 'amber',
          agentModel: SupportedModelId('gpt-4o'),
          turnNumber: 3,
        },
      },
    })

    const { result } = renderHook(() => useWaggleMetadataLookup(session, messages))
    expect(result.current['ui-assistant-live']).toMatchObject({
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
      turnNumber: 3,
    })
  })

  it('preserves live message metadata after a mid-turn Waggle stop', () => {
    const config = makeConfig()
    const session = makeSessionDetail(config)
    const messages = [makeUserMessage('current-user'), makeAssistantMessage('aborted-assistant')]

    useWaggleStore.setState({
      activeConfig: config,
      status: 'stopped',
      liveMessageMetadata: {
        'aborted-assistant': {
          agentIndex: 0,
          agentLabel: 'Architect',
          agentColor: 'blue',
          agentModel: SupportedModelId('claude-sonnet-4-5'),
          turnNumber: 0,
        },
      },
    })

    const { result } = renderHook(() => useWaggleMetadataLookup(session, messages))
    expect(result.current['aborted-assistant']).toMatchObject({
      agentLabel: 'Architect',
      agentColor: 'blue',
      turnNumber: 0,
    })
  })

  it('maps each live assistant message id directly when multiple messages stream in a waggle run', () => {
    const config = makeConfig()
    const session = makeSessionDetail(config)
    const messages = [
      makeAssistantMessage('ui-assistant-live-a'),
      makeAssistantMessage('ui-assistant-live-b'),
    ]

    useWaggleStore.setState({
      activeConfig: config,
      status: 'running',
      completedTurnMeta: [],
      initialTurnMeta: {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 0,
      },
      liveMessageMetadata: {
        'ui-assistant-live-a': {
          agentIndex: 0,
          agentLabel: 'Architect',
          agentColor: 'blue',
          agentModel: SupportedModelId('claude-sonnet-4-5'),
          turnNumber: 0,
        },
        'ui-assistant-live-b': {
          agentIndex: 1,
          agentLabel: 'Reviewer',
          agentColor: 'amber',
          agentModel: SupportedModelId('gpt-4o'),
          turnNumber: 1,
        },
      },
    })

    const { result } = renderHook(() => useWaggleMetadataLookup(session, messages))
    expect(result.current['ui-assistant-live-a']).toMatchObject({
      agentLabel: 'Architect',
      turnNumber: 0,
    })
    expect(result.current['ui-assistant-live-b']).toMatchObject({
      agentLabel: 'Reviewer',
      turnNumber: 1,
    })
  })

  it('matches persisted metadata by message id when transcript projection filters tool nodes', () => {
    const config = makeConfig()
    const { architectMeta, reviewerMeta, session } = makeProjectedSession(config)
    const projectedMessages = [
      makeAssistantMessage('architect-node'),
      makeAssistantMessage('reviewer-node'),
    ]

    const { result } = renderHook(() => useWaggleMetadataLookup(session, projectedMessages))
    expect(result.current['architect-node']).toEqual(architectMeta)
    expect(result.current['reviewer-node']).toEqual(reviewerMeta)
  })

  it('uses active turn metadata for live assistant output after the latest user message', () => {
    const config = makeConfig()
    const session = makeSessionDetail(config)
    const messages = [
      makeAssistantMessage('old-standard-assistant'),
      makeUserMessage('current-user'),
      makeAssistantMessage('live-assistant-without-start-meta'),
    ]

    useWaggleStore.setState({
      activeConfig: config,
      status: 'running',
      completedTurnMeta: [],
      initialTurnMeta: {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: SupportedModelId('claude-sonnet-4-5'),
        turnNumber: 0,
      },
      currentAgentIndex: 0,
      currentAgentLabel: 'Architect',
    })

    const { result } = renderHook(() => useWaggleMetadataLookup(session, messages))
    expect(result.current['old-standard-assistant']).toBeUndefined()
    expect(result.current['live-assistant-without-start-meta']).toMatchObject({
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: SupportedModelId('claude-sonnet-4-5'),
    })
  })
})
