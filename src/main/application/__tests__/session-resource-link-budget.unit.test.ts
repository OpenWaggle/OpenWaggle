import type { Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import {
  ASSISTANT_LINK_CAPTURE_LIMIT,
  captureSuccessfulRunResources,
} from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

const EXCESS_LINK_COUNT = ASSISTANT_LINK_CAPTURE_LIMIT + 8

function linkMessage(index: number, count: number): Message {
  const markdown = Array.from(
    { length: count },
    (_, linkIndex) =>
      `[Source ${String(index)}-${String(linkIndex)}](https://sources.example/${String(index)}/${String(linkIndex)})`,
  ).join('\n')
  return {
    id: MessageId(`assistant-links-${String(index)}`),
    role: 'assistant',
    parts: [{ type: 'text', text: markdown }],
    createdAt: index,
  }
}

function capturedResource(input: UpsertSessionResourceInput): SessionResource {
  return {
    id: input.id,
    sessionId: input.sessionId,
    canonicalKey: input.canonicalKey,
    kind: input.kind,
    title: input.title,
    mimeType: input.mimeType,
    locator: input.locator,
    available: input.available,
    isSource: true,
    isOutput: false,
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

describe('assistant link capture budgets', () => {
  it('caps ordinary links across every assistant message in one successful run', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-many-links',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [linkMessage(0, 20), linkMessage(1, 20)],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts.filter((resource) => resource.kind === 'link')).toHaveLength(
      ASSISTANT_LINK_CAPTURE_LIMIT,
    )
  })

  it('bounds one lazy backfill pass and resumes after cataloged link occurrences', async () => {
    const messages = [linkMessage(0, EXCESS_LINK_COUNT)]
    const firstUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(sessionResourceTestLayer(firstUpserts)),
      ),
    )

    expect(firstUpserts).toHaveLength(ASSISTANT_LINK_CAPTURE_LIMIT)
    const cataloged = firstUpserts.map(capturedResource)
    const resumedUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(resumedUpserts, {
            listedResources: cataloged,
          }),
        ),
      ),
    )

    expect(resumedUpserts).toHaveLength(EXCESS_LINK_COUNT - ASSISTANT_LINK_CAPTURE_LIMIT)
  })
})
