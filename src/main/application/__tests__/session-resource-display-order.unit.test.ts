import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { backfillDisplayMetadata } from '../session-resource-backfill-display-metadata'
import { captureGeneratedImage, captureSuccessfulRunResources } from '../session-resource-capture'
import { PNG_BASE64, sessionResourceTestLayer } from './session-resource-capture.fixtures'

const SESSION_ID = SessionId('session-1')

function imageToolPart(): Message['parts'][number] {
  return {
    type: 'tool-result',
    toolResult: {
      id: ToolCallId('image-tool'),
      name: 'imagegen',
      args: {},
      result: {
        content: [
          { type: 'image', data: PNG_BASE64, mimeType: 'image/png', name: 'generated.png' },
        ],
      },
      isError: false,
      duration: 10,
    },
  }
}

describe('session image occurrence display metadata', () => {
  it('reindexes legacy mixed image occurrences without renumbering their stable ids', () => {
    const message: Message = {
      id: MessageId('assistant'),
      role: 'assistant',
      parts: [
        { type: 'text', text: '![Remote](https://images.example/remote.png)' },
        imageToolPart(),
      ],
      createdAt: 2000,
    }
    const metadata = backfillDisplayMetadata(SESSION_ID, [
      { message, nodeId: 'assistant', branchId: null },
    ])
    expect(
      metadata.map(({ value, prefix, displayName, displayOrder }) => ({
        value,
        prefix,
        displayName,
        displayOrder,
      })),
    ).toEqual([
      {
        value: expect.stringContaining(':created:image:0:'),
        prefix: true,
        displayName: 'generated.png',
        displayOrder: 1,
      },
      {
        value: expect.stringContaining(':read:link:0:'),
        prefix: false,
        displayName: 'Remote',
        displayOrder: 0,
      },
    ])
  })

  it('orders generated and linked agent images by their position in the message', async () => {
    const remote = { type: 'text' as const, text: '![Remote](https://images.example/remote.png)' }
    const generated = imageToolPart()
    for (const parts of [
      [remote, generated],
      [generated, remote],
    ]) {
      const upserts: UpsertSessionResourceInput[] = []
      await Effect.runPromise(
        captureSuccessfulRunResources({
          sessionId: SESSION_ID,
          runId: 'run-mixed-images',
          payload: { text: 'Show both', thinkingLevel: 'medium', attachments: [] },
          messages: [
            {
              id: MessageId('user'),
              role: 'user',
              parts: [{ type: 'text', text: 'Show both' }],
              createdAt: 1000,
            },
            { id: MessageId('assistant'), role: 'assistant', parts, createdAt: 2000 },
          ],
        }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
      )

      const images = upserts
        .filter(({ kind }) => kind === 'image')
        .sort(
          (left, right) =>
            (left.occurrence.displayOrder ?? 0) - (right.occurrence.displayOrder ?? 0),
        )
      expect(images.map(({ occurrence }) => occurrence.displayOrder)).toEqual([0, 1])
      expect(images.map(({ occurrence }) => occurrence.actor)).toEqual(
        parts[0]?.type === 'text' ? ['agent', 'tool'] : ['tool', 'agent'],
      )
      expect(images.find(({ occurrence }) => occurrence.actor === 'tool')?.occurrence.id).toContain(
        ':created:image:0:',
      )
      expect(
        images.find(({ occurrence }) => occurrence.actor === 'agent')?.occurrence.id,
      ).toContain(':read:link:0:')
    }
  })

  it('preserves the current tool image filename when its bytes reuse an older resource', async () => {
    const existing: SessionResource = {
      id: 'existing-image',
      sessionId: SESSION_ID,
      canonicalKey: 'sha256:existing',
      kind: 'image',
      title: 'original.png',
      mimeType: 'image/png',
      locator: 'session-resource://existing-image',
      managed: true,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureGeneratedImage({
        sessionId: SESSION_ID,
        runId: 'run-reused',
        image: { data: PNG_BASE64, mimeType: 'image/png', title: 'renamed.png' },
        index: 0,
        nodeId: 'assistant',
        createdAt: 2000,
        actor: 'tool',
        label: 'imagegen',
        displayOrder: 2,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { existingResource: existing }))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        title: 'original.png',
        occurrence: expect.objectContaining({
          label: 'imagegen',
          displayName: 'renamed.png',
          displayOrder: 2,
        }),
      }),
    )
  })
})
