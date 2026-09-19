import type { Message } from '@shared/types/agent'
import { SessionId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import {
  assistantToolResultMessage,
  capturedResource,
  PNG_BASE64,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

it('keeps later image and link slots stable when an earlier tool projection needs retry', async () => {
  const first = assistantToolResultMessage(false, {
    name: 'read',
    args: { path: 'image.png' },
    result: {
      content: [
        { type: 'image', data: 'invalid-image', mimeType: 'image/png' },
        { type: 'resource_link', uri: 'https://example.com/first' },
      ],
    },
  })
  const message: Message = {
    ...first,
    parts: [
      ...first.parts,
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('second-tool'),
          name: 'imagegen',
          args: {},
          result: {
            content: [
              { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
              { type: 'resource_link', uri: 'https://example.com/second' },
            ],
          },
          isError: false,
          duration: 1,
        },
      },
      { type: 'text', text: '[Final source](https://example.com/final)' },
    ],
  }
  const firstUpserts: UpsertSessionResourceInput[] = []
  const firstPass = await Effect.runPromise(
    captureProjectedSessionResources({
      sessionId: SessionId('session-1'),
      messages: [message],
    }).pipe(
      Effect.provide(
        sessionResourceTestLayer(firstUpserts, {
          sessionWorkingPath: '/project',
          upsertFailsForKinds: ['file'],
        }),
      ),
    ),
  )
  expect(firstPass.fullyProjected).toBe(false)
  expect(firstUpserts.find(({ kind }) => kind === 'image')?.occurrence.id).toContain(
    ':created:image:1:',
  )
  const persisted = firstUpserts.filter(({ kind }) => kind !== 'file').map(capturedResource)
  const retryUpserts: UpsertSessionResourceInput[] = []
  const retry = await Effect.runPromise(
    captureProjectedSessionResources({
      sessionId: SessionId('session-1'),
      messages: [message],
    }).pipe(
      Effect.provide(
        sessionResourceTestLayer(retryUpserts, {
          sessionWorkingPath: '/project',
          listedResources: persisted,
        }),
      ),
    ),
  )
  expect(retry.fullyProjected).toBe(true)
  expect(retryUpserts.filter(({ kind }) => kind === 'image')).toEqual([
    expect.objectContaining({
      available: false,
      occurrence: expect.objectContaining({ id: expect.stringContaining(':created:image:0:') }),
    }),
  ])
  expect(retryUpserts.filter(({ kind }) => kind === 'link').map(({ locator }) => locator)).toEqual([
    'https://example.com/first',
  ])
})

it('backfills mixed linked and generated images in persisted message order', async () => {
  const tool = assistantToolResultMessage(false, {
    name: 'imagegen',
    result: {
      content: [{ type: 'image', data: PNG_BASE64, mimeType: 'image/png', name: 'drawn.png' }],
    },
  })
  const message: Message = {
    ...tool,
    parts: [
      { type: 'text', text: '![First](https://example.com/first.png)' },
      ...tool.parts,
      { type: 'text', text: '![Last](https://example.com/last.png)' },
    ],
  }
  const upserts: UpsertSessionResourceInput[] = []
  const result = await Effect.runPromise(
    captureProjectedSessionResources({
      sessionId: SessionId('session-1'),
      messages: [message],
    }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/project' }))),
  )

  expect(result.fullyProjected).toBe(true)
  expect(
    upserts
      .filter(({ kind }) => kind === 'image')
      .sort(
        (left, right) => (left.occurrence.displayOrder ?? 0) - (right.occurrence.displayOrder ?? 0),
      )
      .map(({ occurrence }) => [occurrence.displayOrder, occurrence.displayName]),
  ).toEqual([
    [0, 'First'],
    [1, 'drawn.png'],
    [2, 'Last'],
  ])
})
