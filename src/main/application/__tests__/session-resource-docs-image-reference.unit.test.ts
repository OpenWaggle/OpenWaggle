import { SessionId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { collectExplicitResources } from '../session-resource-extraction'
import { assistantToolResultMessage } from './session-resource-capture.fixtures'
import { sessionResourceTestLayer } from './session-resource-capture-test-layer'

const DOCS_TOPIC_TEXT = [
  'Topic: openwaggle:using-openwaggle/hives-and-sessions (OpenWaggle docs): Hives and Sessions',
  '',
  '![A Queen Session in the sidebar with its Hive listed in the Hive panel](/screenshots/hive-sessions.png)',
].join('\n')
const WEBSITE_IMAGE_URL = 'https://openwaggle.ai/screenshots/hive-sessions.png'

function docsReadResult(source: string): { readonly result: JsonValue; details: JsonValue } {
  const details = { topic: 'openwaggle:using-openwaggle/hives-and-sessions', source }
  return {
    result: { content: [{ type: 'text', text: DOCS_TOPIC_TEXT }], details },
    details,
  }
}

function docsReadMessage(source: string) {
  return assistantToolResultMessage(false, {
    name: 'openwaggle_docs',
    args: { action: 'read', topic: 'openwaggle:using-openwaggle/hives-and-sessions' },
    ...docsReadResult(source),
  })
}

function imageUpserts(upserts: readonly UpsertSessionResourceInput[]) {
  return upserts.filter((upsert) => upsert.kind === 'image')
}

describe('images referenced by an openwaggle_docs topic', () => {
  it('resolves a docs image path against the website instead of reading it as a file', () => {
    const extracted = collectExplicitResources(DOCS_TOPIC_TEXT, {
      kind: 'website',
      origin: 'https://openwaggle.ai',
    })

    expect(extracted.images).toEqual([])
    expect(extracted.links).toEqual([
      {
        url: WEBSITE_IMAGE_URL,
        title: 'A Queen Session in the sidebar with its Hive listed in the Hive panel',
        image: true,
      },
    ])
  })

  it('keeps Markdown images out of local files when the text names none', () => {
    const extracted = collectExplicitResources(
      '![Local](/tmp/shot.png) ![Remote](https://example.com/remote.png)',
      { kind: 'none' },
    )

    expect(extracted.images).toEqual([])
    expect(extracted.links).toEqual([
      { url: 'https://example.com/remote.png', title: 'Remote', image: true },
    ])
  })

  it('records a docs image as a source the tool read, with its website URL', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-docs',
        payload: { text: '', attachments: [] },
        messages: [docsReadMessage('openwaggle')],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(imageUpserts(upserts)).toEqual([
      expect.objectContaining({
        locator: WEBSITE_IMAGE_URL,
        available: true,
        managedPath: null,
        occurrence: expect.objectContaining({
          actor: 'tool',
          activity: 'read',
          label: 'openwaggle_docs',
          locator: WEBSITE_IMAGE_URL,
        }),
      }),
    ])
  })

  it('never backfills a docs image as an unavailable output', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [docsReadMessage('openwaggle')],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { readSourceFails: true }))),
    )

    const images = imageUpserts(upserts)
    expect(images).toEqual([
      expect.objectContaining({
        locator: WEBSITE_IMAGE_URL,
        available: true,
        occurrence: expect.objectContaining({ activity: 'read', locator: WEBSITE_IMAGE_URL }),
      }),
    ])
    expect(images.some((upsert) => upsert.canonicalKey.startsWith('unavailable-image:'))).toBe(
      false,
    )
  })

  it('ignores root-relative images in Pi and extension docs, which have no website', async () => {
    for (const source of ['pi', 'extension']) {
      const upserts: UpsertSessionResourceInput[] = []
      await Effect.runPromise(
        captureProjectedSessionResources({
          sessionId: SessionId('session-1'),
          messages: [docsReadMessage(source)],
        }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { readSourceFails: true }))),
      )
      expect(imageUpserts(upserts)).toEqual([])
    }
  })
})
