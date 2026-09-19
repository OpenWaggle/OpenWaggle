import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import {
  captureSuccessfulRunResources,
  SESSION_TOOL_CAPTURE_LIMIT,
} from '../session-resource-capture'
import {
  capturedResource,
  PNG_BASE64,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

it('preserves later Markdown image and link identities after the live tool capture limit', async () => {
  const sessionId = SessionId('session-1')
  const message: Message = {
    id: MessageId('bounded-tools'),
    role: 'assistant',
    createdAt: 1000,
    parts: [
      ...Array.from({ length: SESSION_TOOL_CAPTURE_LIMIT }, (_, index) => ({
        type: 'tool-result' as const,
        toolResult: {
          id: ToolCallId(`empty-tool-${String(index)}`),
          name: 'grep',
          args: {},
          result: 'No matches',
          isError: false,
          duration: 1,
        },
      })),
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('deferred-image-tool'),
          name: 'imagegen',
          args: {},
          result: {
            content: [
              { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
              { type: 'resource_link', uri: 'https://example.com/skipped' },
            ],
          },
          isError: false,
          duration: 1,
        },
      },
      {
        type: 'text',
        text: '![Later image](https://example.com/later.png)\n[Later source](https://example.com/later)',
      },
    ],
  }
  const liveUpserts: UpsertSessionResourceInput[] = []
  await Effect.runPromise(
    captureSuccessfulRunResources({
      sessionId,
      runId: 'bounded-tools-run',
      payload: { text: '', thinkingLevel: 'medium', attachments: [] },
      messages: [message],
    }).pipe(Effect.provide(sessionResourceTestLayer(liveUpserts))),
  )
  const backfillUpserts: UpsertSessionResourceInput[] = []
  const backfill = await Effect.runPromise(
    captureProjectedSessionResources({ sessionId, messages: [message] }).pipe(
      Effect.provide(
        sessionResourceTestLayer(backfillUpserts, {
          listedResources: liveUpserts.map(capturedResource),
        }),
      ),
    ),
  )

  expect(backfill.fullyProjected).toBe(true)
  expect(liveUpserts.some(({ locator }) => locator === 'https://example.com/later.png')).toBe(true)
  expect(
    liveUpserts.some(({ canonicalKey }) => canonicalKey === 'url:https://example.com/skipped'),
  ).toBe(false)
  expect(
    backfillUpserts
      .filter(({ locator }) => locator?.startsWith('https:'))
      .map(({ locator }) => locator),
  ).toEqual(['https://example.com/skipped'])
  expect(backfillUpserts.find(({ kind }) => kind === 'image')?.occurrence.id).toContain(
    ':created:image:0:',
  )
})
