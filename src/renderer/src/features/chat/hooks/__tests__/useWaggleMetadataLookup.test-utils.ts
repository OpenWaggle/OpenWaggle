import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle'

export function makeConfig() {
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
  } satisfies WaggleConfig
}

export function makeSessionDetail(config: WaggleConfig, metadata?: WaggleMessageMetadata) {
  return {
    id: SessionId('session-waggle'),
    title: 'Waggle SessionDetail',
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
  } satisfies SessionDetail
}

export function makeAssistantMessage(id: string) {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', content: 'draft' }],
  } satisfies UIMessage
}

export function makeUserMessage(id: string) {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: 'question' }],
  } satisfies UIMessage
}

export function makeProjectedSession(config: WaggleConfig) {
  const architectMeta: WaggleMessageMetadata = {
    agentIndex: 0,
    agentLabel: 'Architect',
    agentColor: 'blue',
    agentModel: SupportedModelId('claude-sonnet-4-5'),
    turnNumber: 0,
  }
  const reviewerMeta: WaggleMessageMetadata = {
    agentIndex: 1,
    agentLabel: 'Reviewer',
    agentColor: 'amber',
    agentModel: SupportedModelId('gpt-4o'),
    turnNumber: 1,
  }

  return {
    architectMeta,
    reviewerMeta,
    session: {
      id: SessionId('session-waggle'),
      title: 'Waggle SessionDetail',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      waggleConfig: config,
      messages: [
        {
          id: MessageId('architect-node'),
          role: 'assistant',
          createdAt: 1,
          parts: [{ type: 'text', text: 'architect' }],
          metadata: { waggle: architectMeta },
        },
        {
          id: MessageId('tool-result-node'),
          role: 'assistant',
          createdAt: 2,
          parts: [
            {
              type: 'tool-result',
              toolResult: {
                id: ToolCallId('tool-1'),
                name: 'bash',
                args: {},
                result: 'ok',
                isError: false,
                duration: 1,
              },
            },
          ],
        },
        {
          id: MessageId('reviewer-node'),
          role: 'assistant',
          createdAt: 3,
          parts: [{ type: 'text', text: 'reviewer' }],
          metadata: { waggle: reviewerMeta },
        },
      ],
    } satisfies SessionDetail,
  }
}
