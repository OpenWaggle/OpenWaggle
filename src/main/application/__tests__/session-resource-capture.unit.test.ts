import type { AgentSendPayload, Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureAttachment, captureSuccessfulRunResources } from '../session-resource-capture'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

const REMOTE_IMAGE_REFERENCE_LIMIT = 32
const EXCESS_REMOTE_IMAGE_COUNT = REMOTE_IMAGE_REFERENCE_LIMIT + 8

describe('captureSuccessfulRunResources', () => {
  it('links user attachments and agent images to the message that displayed them', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedAttachmentSha256: Array<string | undefined> = []
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
          contentSha256: 'a'.repeat(64),
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
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storedAttachmentSha256 }))),
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
    expect(storedAttachmentSha256).toEqual(['a'.repeat(64)])
  })

  it('retains unavailable attachment metadata when the managed copy cannot be created', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-missing-attachment',
        payload: {
          text: 'Review the attachment.',
          thinkingLevel: 'medium',
          attachments: [
            {
              id: 'attachment-missing',
              kind: 'image',
              name: 'missing.png',
              path: '/input/missing.png',
              mimeType: 'image/png',
              sizeBytes: 42,
              extractedText: '',
            },
          ],
        },
        messages: resourceMessages(),
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storeFileFails: true }))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: expect.stringMatching(/^unavailable-attachment:.*:attachment-missing:0$/u),
        kind: 'file',
        title: 'missing.png',
        mimeType: 'image/png',
        locator: '/input/missing.png',
        managedPath: null,
        available: false,
        occurrence: expect.objectContaining({ actor: 'user', activity: 'provided' }),
      }),
    )
  })

  it('retries an unavailable attachment occurrence into the same resource', async () => {
    const unavailable: SessionResource = {
      id: 'missing-resource',
      sessionId: SessionId('session-1'),
      canonicalKey: 'file:/input/missing.png',
      kind: 'image',
      title: 'missing.png',
      mimeType: 'image/png',
      locator: '/input/missing.png',
      managed: false,
      available: false,
      isSource: true,
      isOutput: false,
      occurrences: [
        {
          id: 'session-1:user-message:provided:attachment:attachment-missing:0',
          nodeId: 'user-message',
          branchId: null,
          actor: 'user',
          activity: 'provided',
          label: null,
          createdAt: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const upserts: UpsertSessionResourceInput[] = []
    const rekeyedCanonicalKeys: string[] = []

    await Effect.runPromise(
      captureAttachment({
        sessionId: SessionId('session-1'),
        runId: 'backfill:user-message',
        attachment: {
          id: 'attachment-missing',
          kind: 'image',
          name: 'missing.png',
          path: '/input/missing.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          extractedText: '',
        },
        index: 0,
        nodeId: 'user-message',
        createdAt: 1000,
        repairResource: unavailable,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            existingResource: unavailable,
            hasOccurrence: true,
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        id: 'missing-resource',
        canonicalKey: 'sha256:attachment-digest',
        locator: '/input/missing.png',
        managedPath: '/managed/missing-resource-missing.png',
        available: true,
      }),
    )
    expect(rekeyedCanonicalKeys).toEqual(['sha256:attachment-digest'])
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
        canonicalKey: 'image-url:https://images.example/architecture.png',
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
})
