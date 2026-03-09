import { ConversationId, MessageId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '@/stores/waggle-store'
import { useWaggleMetadataLookup } from '../useWaggleMetadataLookup'

function makeConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: SupportedModelId('claude-sonnet-4-5'),
        roleDescription: 'System designer',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('gpt-4o'),
        roleDescription: 'Code reviewer',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 10 },
  }
}

function makeConversation(config: WaggleConfig, metadata?: WaggleMessageMetadata): Conversation {
  return {
    id: ConversationId('conv-waggle'),
    title: 'Waggle Conversation',
    projectPath: null,
    createdAt: 1,
    updatedAt: 1,
    waggleConfig: config,
    messages: [
      {
        id: MessageId('assistant-1'),
        role: 'assistant',
        createdAt: 1,
        parts: [{ type: 'text', text: 'draft' }],
        metadata: metadata ? { waggle: metadata } : undefined,
      },
    ],
  }
}

function makeAssistantMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', content: 'draft' }],
  }
}

describe('useWaggleMetadataLookup', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
  })

  it('returns the same lookup reference when inputs and waggle state are unchanged', () => {
    const config = makeConfig()
    const metadata: WaggleMessageMetadata = {
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: SupportedModelId('claude-sonnet-4-5'),
      turnNumber: 0,
    }
    const conversation = makeConversation(config, metadata)
    const messages = [makeAssistantMessage('ui-assistant-1')]

    const { result, rerender } = renderHook(
      ({
        currentConversation,
        currentMessages,
      }: {
        currentConversation: Conversation | null
        currentMessages: UIMessage[]
      }) => useWaggleMetadataLookup(currentConversation, currentMessages),
      {
        initialProps: {
          currentConversation: conversation,
          currentMessages: messages,
        },
      },
    )

    const firstLookup = result.current
    rerender({
      currentConversation: conversation,
      currentMessages: messages,
    })

    expect(result.current).toBe(firstLookup)
    expect(result.current['ui-assistant-1']).toEqual(metadata)
  })

  it('returns a new lookup when live waggle state changes', () => {
    const config = makeConfig()
    const conversation = makeConversation(config)
    const messages = [
      makeAssistantMessage('ui-assistant-1'),
      makeAssistantMessage('ui-assistant-2'),
    ]

    const { result, rerender } = renderHook(
      ({
        currentConversation,
        currentMessages,
      }: {
        currentConversation: Conversation | null
        currentMessages: UIMessage[]
      }) => useWaggleMetadataLookup(currentConversation, currentMessages),
      {
        initialProps: {
          currentConversation: conversation,
          currentMessages: messages,
        },
      },
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
    rerender({
      currentConversation: conversation,
      currentMessages: messages,
    })

    expect(result.current).not.toBe(initialLookup)
    expect(result.current['ui-assistant-2']).toMatchObject({
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
    })
  })
})
