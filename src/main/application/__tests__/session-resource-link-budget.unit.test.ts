import type { Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import {
  captureSuccessfulRunResources,
  SESSION_LINK_CAPTURE_LIMIT,
} from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

const EXCESS_LINK_COUNT = SESSION_LINK_CAPTURE_LIMIT + 8

function linkMessage(
  index: number,
  count: number,
  role: 'user' | 'assistant' = 'assistant',
): Message {
  const markdown = Array.from(
    { length: count },
    (_, linkIndex) =>
      `[Source ${String(index)}-${String(linkIndex)}](https://sources.example/${String(index)}/${String(linkIndex)})`,
  ).join('\n')
  return {
    id: MessageId(`${role}-links-${String(index)}`),
    role,
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
    managed: input.managedPath !== null,
    available: input.available,
    isSource: true,
    isOutput: false,
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

describe('session link capture budgets', () => {
  it('shares one cap across user and assistant links in a successful run', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const userLinkCount = 20
    const userMarkdown = linkMessage(0, userLinkCount, 'user').parts[0]
    if (userMarkdown?.type !== 'text') throw new Error('Expected user Markdown.')

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-many-links',
        payload: { text: userMarkdown.text, thinkingLevel: 'medium', attachments: [] },
        messages: [linkMessage(0, 20), linkMessage(1, 20)],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts.filter((resource) => resource.kind === 'link')).toHaveLength(
      SESSION_LINK_CAPTURE_LIMIT,
    )
    expect(upserts.filter((resource) => resource.occurrence.actor === 'user')).toHaveLength(
      userLinkCount,
    )
  })

  it('bounds one mixed-actor lazy backfill pass and resumes after cataloged occurrences', async () => {
    const messages = [linkMessage(0, SESSION_LINK_CAPTURE_LIMIT - 4, 'user'), linkMessage(1, 12)]
    const firstUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(sessionResourceTestLayer(firstUpserts)),
      ),
    )

    expect(firstUpserts).toHaveLength(SESSION_LINK_CAPTURE_LIMIT)
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

    expect(resumedUpserts).toHaveLength(8)
  })

  it('bounds a user-only lazy backfill pass and resumes its remaining links', async () => {
    const messages = [linkMessage(0, EXCESS_LINK_COUNT, 'user')]
    const firstUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(sessionResourceTestLayer(firstUpserts)),
      ),
    )

    expect(firstUpserts).toHaveLength(SESSION_LINK_CAPTURE_LIMIT)
    const resumedUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(resumedUpserts, {
            listedResources: firstUpserts.map(capturedResource),
          }),
        ),
      ),
    )

    expect(resumedUpserts).toHaveLength(EXCESS_LINK_COUNT - SESSION_LINK_CAPTURE_LIMIT)
  })
})
