import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import {
  advanceGeneratedImageCaptureBudget,
  captureSuccessfulRunResources,
  GENERATED_IMAGE_CAPTURE_LIMITS,
} from '../session-resource-capture'
import {
  PNG_BASE64,
  resourceMessages,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

describe('generated-image capture budget', () => {
  it('caps generated-image capture across the whole run', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const template = resourceMessages().find((message) => message.role === 'assistant')
    if (!template) throw new Error('Expected the assistant fixture message.')
    const messages: Message[] = Array.from(
      { length: GENERATED_IMAGE_CAPTURE_LIMITS.maxCount + 8 },
      (_, index) => ({
        ...template,
        id: MessageId(`assistant-generated-${String(index)}`),
      }),
    )

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-many-generated-images',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storedByteFiles }))),
    )

    expect(storedByteFiles).toHaveLength(GENERATED_IMAGE_CAPTURE_LIMITS.maxCount)
    expect(upserts.filter((resource) => resource.kind === 'image')).toHaveLength(
      GENERATED_IMAGE_CAPTURE_LIMITS.maxCount,
    )
  })

  it('rejects the next generated image when it would exceed the aggregate byte budget', () => {
    expect(
      advanceGeneratedImageCaptureBudget(
        { count: 1, bytes: GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - 1 },
        Buffer.from(PNG_BASE64, 'base64').byteLength,
      ),
    ).toBeNull()
  })

  it('does not charge invalid images against the run budget', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const invalidMessages: Message[] = Array.from(
      { length: GENERATED_IMAGE_CAPTURE_LIMITS.maxCount },
      (_, index) => ({
        id: MessageId(`assistant-invalid-${String(index)}`),
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId(`invalid-image-${String(index)}`),
              name: 'imagegen',
              args: {},
              result: {
                content: [
                  { type: 'image', data: PNG_BASE64, mimeType: 'application/octet-stream' },
                ],
              },
              isError: false,
              duration: 1,
            },
          },
        ],
        createdAt: index,
      }),
    )
    const validMessage = resourceMessages().find((message) => message.role === 'assistant')
    if (!validMessage) throw new Error('Expected the assistant fixture message.')

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-invalid-before-valid',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [...invalidMessages, validMessage],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storedByteFiles }))),
    )

    expect(storedByteFiles).toHaveLength(1)
    expect(upserts.filter((resource) => resource.kind === 'image')).toHaveLength(1)
  })
})
