import type { AgentSendPayload, Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('captureSuccessfulRunResources', () => {
  it('links user attachments and agent images to the message that displayed them', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const payload: AgentSendPayload = {
      text: 'Review [reference](https://user.example/reference)',
      thinkingLevel: 'medium',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'image',
          name: 'reference.png',
          path: '/input/reference.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          extractedText: '',
        },
      ],
    }

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        payload,
        messages: resourceMessages(),
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          title: 'reference.png',
          occurrence: expect.objectContaining({
            nodeId: 'user-message',
            actor: 'user',
            activity: 'provided',
          }),
        }),
        expect.objectContaining({
          kind: 'image',
          occurrence: expect.objectContaining({
            nodeId: 'assistant-message',
            actor: 'agent',
            activity: 'created',
          }),
        }),
      ]),
    )
  })

  it('records user links as sources on the user message and agent citations as read sources', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        payload: {
          text: 'Review [reference](https://user.example/reference)',
          thinkingLevel: 'medium',
          attachments: [],
        },
        messages: resourceMessages(),
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKey: 'url:https://user.example/reference',
          occurrence: expect.objectContaining({ nodeId: 'user-message', activity: 'provided' }),
        }),
        expect.objectContaining({
          canonicalKey: 'url:https://agent.example/source',
          occurrence: expect.objectContaining({ nodeId: 'assistant-message', activity: 'read' }),
        }),
      ]),
    )
  })

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

  it('removes a newly copied duplicate when the catalog preserves an existing managed image', async () => {
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

    expect(removedPaths).toHaveLength(2)
    expect(removedPaths.every((managedPath) => managedPath.startsWith('/managed/'))).toBe(true)
  })

  it('backfills explicit resources from persisted messages with deterministic occurrences', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const persisted = resourceMessages()
    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: persisted,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKey: 'url:https://user.example/reference',
          occurrence: expect.objectContaining({
            id: expect.stringContaining('backfill:user-message'),
            nodeId: 'user-message',
          }),
        }),
        expect.objectContaining({
          kind: 'image',
          occurrence: expect.objectContaining({
            id: expect.stringContaining('backfill:assistant-message'),
            nodeId: 'assistant-message',
          }),
        }),
      ]),
    )
  })

  it('does not rewrite managed image bytes when backfill finds the canonical resource', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const existingResource: SessionResource = {
      id: 'existing-image',
      sessionId: SessionId('session-1'),
      canonicalKey: `sha256:${'unused'}`,
      kind: 'image',
      title: 'Generated image.png',
      mimeType: 'image/png',
      locator: 'session-resource://existing-image',
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const assistantMessage = resourceMessages()[1]
    if (!assistantMessage) throw new Error('Expected the assistant fixture message.')

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantMessage],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { existingResource, storedByteFiles })),
      ),
    )

    expect(storedByteFiles).toEqual([])
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'existing-image',
          locator: 'session-resource://existing-image',
        }),
      ]),
    )
  })
})
