import os from 'node:os'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { localImageCaptureRoots } from '../session-resource-capture-image-preparation'
import { collectExplicitResources } from '../session-resource-extraction'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

const LOCAL_IMAGE_PATH = '/tmp/electron-qa-evidence/evidence.png'
const LOCAL_IMAGE_MARKDOWN = `![QA evidence](file://${LOCAL_IMAGE_PATH})`

function assistantLocalImageMessage() {
  return {
    id: MessageId('assistant-local-image'),
    role: 'assistant' as const,
    parts: [{ type: 'text' as const, text: LOCAL_IMAGE_MARKDOWN }],
    createdAt: 1000,
  }
}

function capturedResource(input: UpsertSessionResourceInput): SessionResource {
  return {
    ...input,
    managed: input.managedPath !== null,
    occurrences: [input.occurrence],
    isSource: false,
    isOutput: true,
  }
}

function expectCapturedLocalImage(upserts: readonly UpsertSessionResourceInput[]) {
  expect(upserts).toContainEqual(
    expect.objectContaining({
      kind: 'image',
      title: 'QA evidence.png',
      mimeType: 'image/png',
      available: true,
      managedPath: expect.stringMatching(/^\/managed\//u),
      occurrence: expect.objectContaining({
        nodeId: 'assistant-local-image',
        actor: 'agent',
        activity: 'created',
        locator: LOCAL_IMAGE_PATH,
      }),
    }),
  )
}

describe('local assistant Markdown image capture', () => {
  it('authorizes the workspace and dedicated agent image directories', () => {
    const roots = localImageCaptureRoots('/workspace')

    expect(roots).toContain('/workspace')
    expect(roots).toContain(`${os.tmpdir()}/electron-qa-evidence`)
    expect(roots).not.toContain(os.tmpdir())
    if (process.platform !== 'win32') {
      expect(roots).toContain('/tmp/electron-qa-evidence')
      expect(roots).not.toContain('/tmp')
    }
  })

  it('extracts supported file images without treating local files as links', () => {
    const extracted = collectExplicitResources(`
${LOCAL_IMAGE_MARKDOWN}
[Local file](file:///tmp/electron-qa/report.txt)
![Unsupported](file:///tmp/electron-qa/vector.svg)
`)

    expect(extracted.images).toEqual([
      {
        filePath: LOCAL_IMAGE_PATH,
        mimeType: 'image/png',
        title: 'QA evidence',
      },
    ])
    expect(extracted.links).toEqual([])
    expect(extracted.order).toEqual([{ kind: 'image', index: 0 }])
  })

  it('copies new run images into managed Session resources', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-local-image',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [assistantLocalImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storedByteFiles }))),
    )

    expect(storedByteFiles).toEqual(['QA evidence.png'])
    expectCapturedLocalImage(upserts)
  })

  it('backfills images from persisted assistant messages', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantLocalImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expectCapturedLocalImage(upserts)
  })

  it('records disappeared local images without stalling later backfill pages', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    const result = await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantLocalImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { readSourceFails: true }))),
    )

    expect(result).toEqual({ progressed: true, fullyProjected: true })
    expect(upserts).toContainEqual(
      expect.objectContaining({
        available: false,
        managedPath: null,
        occurrence: expect.objectContaining({ locator: LOCAL_IMAGE_PATH }),
      }),
    )
  })

  it('retries and merges a targeted unavailable local image', async () => {
    const unavailableUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantLocalImageMessage()],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(unavailableUpserts, { readSourceFails: true })),
      ),
    )
    const unavailable = unavailableUpserts.at(0)
    if (!unavailable) throw new Error('Expected an unavailable local image resource.')
    const unavailableResource = capturedResource(unavailable)
    const repairedUpserts: UpsertSessionResourceInput[] = []
    const rekeyedCanonicalKeys: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantLocalImageMessage()],
        retryUnavailableResourceId: unavailableResource.id,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(repairedUpserts, {
            existingResource: unavailableResource,
            listedResources: [unavailableResource],
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expectCapturedLocalImage(repairedUpserts)
    expect(rekeyedCanonicalKeys).toEqual([expect.stringMatching(/^sha256:/u)])
  })
})
