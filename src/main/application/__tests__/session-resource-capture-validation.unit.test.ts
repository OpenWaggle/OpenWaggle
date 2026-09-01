import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('session resource capture validation', () => {
  it('ignores malformed and oversized generated image payloads', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const huge = Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64')
    const invalidMessages: Message[] = [
      {
        id: MessageId('assistant-message'),
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('image-tool'),
              name: 'imagegen',
              args: {},
              result: {
                content: [
                  { type: 'image', data: '', mimeType: 'image/png' },
                  { type: 'image', data: huge, mimeType: 'image/png' },
                  {
                    type: 'image',
                    data: Buffer.from('not really an image').toString('base64'),
                    mimeType: 'image/png',
                  },
                  {
                    type: 'image',
                    data: Buffer.from('<script>alert(1)</script>').toString('base64'),
                    mimeType: 'text/html',
                  },
                ],
              },
              isError: false,
              duration: 10,
            },
          },
        ],
        createdAt: 2000,
      },
    ]

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: invalidMessages,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual([])
  })

  it.each([
    {
      label: 'a renamed non-image',
      name: 'renamed.png',
      mimeType: 'image/png',
      bytes: Buffer.from('this is plain text'),
    },
    {
      label: 'an active SVG payload',
      name: 'active.svg',
      mimeType: 'image/svg+xml',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    },
  ])('catalogs $label as an ordinary file instead of viewable image content', async (fixture) => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: `run-${fixture.name}`,
        payload: {
          text: '',
          thinkingLevel: 'medium',
          attachments: [
            {
              id: fixture.name,
              kind: 'image',
              name: fixture.name,
              path: `/input/${fixture.name}`,
              mimeType: fixture.mimeType,
              sizeBytes: fixture.bytes.byteLength,
              extractedText: '',
            },
          ],
        },
        messages: resourceMessages(),
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { storedAttachmentBytes: fixture.bytes })),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        kind: 'file',
        title: fixture.name,
        locator: `/input/${fixture.name}`,
        managedPath: expect.stringContaining(`/managed/`),
      }),
    )
  })

  it('keeps a replacement copy when canonical deduplication retains another resource id', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const removedPaths: string[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-duplicate',
        payload: {
          text: '',
          thinkingLevel: 'medium',
          attachments: [
            {
              id: 'duplicate',
              kind: 'image',
              name: 'duplicate.png',
              path: '/input/duplicate.png',
              mimeType: 'image/png',
              sizeBytes: 42,
              extractedText: '',
            },
          ],
        },
        messages: resourceMessages(),
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            duplicateLocator: 'session-resource://existing-resource',
            removedPaths,
          }),
        ),
      ),
    )

    expect(removedPaths).toHaveLength(1)
    expect(removedPaths[0]).toMatch(/\/managed\/.*-Generated image\.png$/)
  })
})
