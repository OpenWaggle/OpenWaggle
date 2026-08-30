import type { AgentSendPayload, Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

const REMOTE_IMAGE_REFERENCE_LIMIT = 32
const EXCESS_REMOTE_IMAGE_COUNT = REMOTE_IMAGE_REFERENCE_LIMIT + 8

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
        nodeIdByMessageId: {
          'user-message': 'persisted-user-node',
          'assistant-message': 'persisted-assistant-node',
        },
        branchIdByMessageId: {
          'user-message': 'branch-user',
          'assistant-message': 'branch-assistant',
        },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          title: 'reference.png',
          occurrence: expect.objectContaining({
            nodeId: 'persisted-user-node',
            branchId: 'branch-user',
            actor: 'user',
            activity: 'provided',
          }),
        }),
        expect.objectContaining({
          kind: 'image',
          occurrence: expect.objectContaining({
            nodeId: 'persisted-assistant-node',
            branchId: 'branch-assistant',
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

  it('catalogs agent Markdown images without fetching them during run settlement', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const fetchedUrls: string[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-remote-image',
        payload: {
          text: 'Show the image.',
          thinkingLevel: 'medium',
          attachments: [],
        },
        messages: [
          {
            id: MessageId('persisted-assistant-node'),
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: '![Architecture](https://images.example/architecture.png)',
              },
            ],
            createdAt: 1000,
          },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { fetchedUrls }))),
    )

    expect(fetchedUrls).toEqual([])
    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'url:https://images.example/architecture.png',
        kind: 'image',
        mimeType: null,
        locator: 'https://images.example/architecture.png',
        managedPath: null,
      }),
    )
  })

  it('bounds agent remote-image references per run without downloading any of them', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const fetchedUrls: string[] = []
    const markdown = Array.from(
      { length: EXCESS_REMOTE_IMAGE_COUNT },
      (_, index) => `![Image ${String(index)}](https://images.example/${String(index)}.png)`,
    ).join('\n')

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-many-remote-images',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          {
            id: MessageId('assistant-many-images'),
            role: 'assistant',
            parts: [{ type: 'text', text: markdown }],
            createdAt: 1000,
          },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { fetchedUrls }))),
    )

    expect(fetchedUrls).toEqual([])
    expect(upserts.filter((resource) => resource.kind === 'image')).toHaveLength(
      REMOTE_IMAGE_REFERENCE_LIMIT,
    )
  })

  it('keeps separate occurrences when two assistant messages share a resource', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const first = resourceMessages()[1]
    if (!first) throw new Error('Expected the assistant fixture message.')
    const second: Message = { ...first, id: MessageId('assistant-message-2'), createdAt: 3000 }

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-shared',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [first, second],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    const generated = upserts.filter((input) => input.kind === 'image')
    expect(generated).toHaveLength(2)
    expect(new Set(generated.map((input) => input.occurrence.id)).size).toBe(2)
    expect(generated.map((input) => input.occurrence.nodeId)).toEqual([
      'assistant-message',
      'assistant-message-2',
    ])
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

  it('replaces a cataloged managed image when its file is no longer readable', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const removedPaths: string[] = []
    const existingResource: SessionResource = {
      id: 'missing-image',
      sessionId: SessionId('session-1'),
      canonicalKey: 'sha256:missing',
      kind: 'image',
      title: 'Generated image.png',
      mimeType: 'image/png',
      locator: 'session-resource://missing-image',
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
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            existingResource,
            existingManagedPath: '/managed/deleted-image.png',
            managedReadFails: true,
            storedByteFiles,
            removedPaths,
          }),
        ),
      ),
    )

    expect(storedByteFiles).toContain('Generated image.png')
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          managedPath: expect.stringMatching(/^\/managed\//u),
          locator: expect.stringMatching(/^session-resource:\/\//u),
        }),
      ]),
    )
    expect(removedPaths).toContain('/managed/deleted-image.png')
  })
})
