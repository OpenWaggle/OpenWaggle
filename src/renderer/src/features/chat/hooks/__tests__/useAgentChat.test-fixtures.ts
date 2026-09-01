import type { AgentSendPayload } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'

export function createSession(): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'SessionDetail',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        createdAt: 1,
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'write',
              args: { path: 'file.txt' },
              state: 'input-complete',
            },
          },
        ],
      },
    ],
  }
}

export function createSessionWithMessages(
  updatedAt: number,
  messages: SessionDetail['messages'],
): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'SessionDetail',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt,
    messages,
  }
}

export function createSessionWithId(id: SessionId): SessionDetail {
  return {
    id,
    title: `Session ${String(id)}`,
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }
}

export function createSessionWithIdAndMessages(
  id: SessionId,
  updatedAt: number,
  messages: SessionDetail['messages'],
): SessionDetail {
  return {
    id,
    title: `Session ${String(id)}`,
    projectPath: `/tmp/${String(id)}`,
    createdAt: 1,
    updatedAt,
    messages,
  }
}

export const SEND_PAYLOAD: AgentSendPayload = {
  text: 'Hello world',
  thinkingLevel: 'medium',
  attachments: [],
}

export function createDeferred<T>() {
  let resolveValue = (_value: T) => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return { promise, resolve: resolveValue }
}
