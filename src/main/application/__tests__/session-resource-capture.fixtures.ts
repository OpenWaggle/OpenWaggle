import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { SessionResource } from '@shared/types/session-resource'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { PNG_BASE64 } from './session-resource-capture-test-layer'

export { PNG_BASE64, sessionResourceTestLayer } from './session-resource-capture-test-layer'

export function resourceMessages(): Message[] {
  return [
    {
      id: MessageId('user-message'),
      role: 'user',
      parts: [{ type: 'text', text: 'Review [reference](https://user.example/reference)' }],
      createdAt: 1000,
    },
    {
      id: MessageId('assistant-message'),
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Source: [documentation](https://agent.example/source)' },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('image-tool'),
            name: 'imagegen',
            args: {},
            result: { content: [{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }] },
            isError: false,
            duration: 10,
          },
        },
      ],
      createdAt: 2000,
    },
  ]
}

export function capturedResource(input: UpsertSessionResourceInput): SessionResource {
  return {
    id: input.id,
    sessionId: input.sessionId,
    canonicalKey: input.canonicalKey,
    kind: input.kind,
    title: input.title,
    mimeType: input.mimeType,
    locator: input.locator,
    managed: input.managedPath !== null,
    available: input.available,
    isSource: input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
    isOutput: input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

export function assistantToolResultMessage(
  isError = false,
  input: {
    readonly name?: string
    readonly args?: Readonly<JsonObject>
    readonly result?: JsonValue
    readonly details?: JsonValue
  } = {},
): Message {
  return {
    id: MessageId('assistant-tool-message'),
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('tool-call-1'),
          name: input.name ?? 'grep',
          args: input.args ?? { pattern: 'SessionResource', path: 'src/main' },
          result: input.result ?? 'src/main/application/session-resource-capture.ts:1',
          isError,
          duration: 12,
          ...(input.details === undefined ? {} : { details: input.details }),
        },
      },
    ],
    createdAt: 2_000,
  }
}
