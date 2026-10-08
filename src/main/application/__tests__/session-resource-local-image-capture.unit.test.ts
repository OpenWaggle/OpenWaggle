import os from 'node:os'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { sessionEvidenceRoot } from '../../utils/session-evidence-directory'
import { sessionScratchDirectoryPath } from '../../utils/session-scratch-directory'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { GENERATED_IMAGE_CAPTURE_LIMITS } from '../session-resource-capture-image-budget'
import {
  localImageCaptureRoots,
  prepareLocalImageForCapture,
} from '../session-resource-capture-image-preparation'
import { collectExplicitResources } from '../session-resource-extraction'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

const LOCAL_IMAGE_PATH = '/tmp/electron-qa-evidence/evidence.png'
const LOCAL_IMAGE_MARKDOWN = `![QA evidence](file://${LOCAL_IMAGE_PATH})`
const PLAIN_IMAGE_PATH = '/tmp/electron-qa-evidence/plain-path.png'
const PLAIN_IMAGE_MARKDOWN = `![QA evidence](${PLAIN_IMAGE_PATH})`

function assistantLocalImageMessage() {
  return {
    id: MessageId('assistant-local-image'),
    role: 'assistant' as const,
    parts: [{ type: 'text' as const, text: LOCAL_IMAGE_MARKDOWN }],
    createdAt: 1000,
  }
}

function assistantPlainPathImageMessage() {
  return {
    id: MessageId('assistant-plain-path-image'),
    role: 'assistant' as const,
    parts: [{ type: 'text' as const, text: PLAIN_IMAGE_MARKDOWN }],
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
    const roots = localImageCaptureRoots('/workspace', 'session-qa')

    expect(roots).toContain('/workspace')
    expect(roots).toContain(`${os.tmpdir()}/electron-qa-evidence`)
    expect(roots).not.toContain(os.tmpdir())
    if (process.platform !== 'win32') {
      expect(roots).toContain('/tmp/electron-qa-evidence')
      expect(roots).not.toContain('/tmp')
    }
  })

  it("authorizes the Session's own scratch directory, which is the agent's TMPDIR", () => {
    const roots = localImageCaptureRoots('/workspace', 'session-qa')

    expect(roots).toContain(sessionScratchDirectoryPath('session-qa'))
    expect(roots).not.toContain(sessionScratchDirectoryPath('session-other'))
  })

  it("authorizes the user's evidence directories, so a Queen can show a Worker's screenshots", () => {
    expect(localImageCaptureRoots('/workspace', 'session-queen')).toContain(sessionEvidenceRoot())
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

  it('extracts images referenced as plain absolute paths, the evidence convention', () => {
    const extracted = collectExplicitResources(`
${PLAIN_IMAGE_MARKDOWN}
![Not an image](/tmp/electron-qa-evidence/notes.txt)
![Relative](./relative.png)
![Scheme-less but not absolute](electron-qa-evidence/shot.png)
`)

    expect(extracted.images).toEqual([
      {
        filePath: PLAIN_IMAGE_PATH,
        mimeType: 'image/png',
        title: 'QA evidence',
      },
    ])
    expect(extracted.order).toEqual([{ kind: 'image', index: 0 }])
  })

  it('reports aggregate byte-budget exhaustion separately from missing files', async () => {
    const result = await Effect.runPromise(
      prepareLocalImageForCapture(
        {
          attempts: 0,
          bytes: GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - 1,
          count: 0,
        },
        { filePath: LOCAL_IMAGE_PATH, mimeType: 'image/png', title: 'QA evidence' },
        localImageCaptureRoots(null, 'session-qa'),
      ).pipe(Effect.provide(sessionResourceTestLayer([], { readSourceFails: true }))),
    )

    expect(result).toMatchObject({ byteBudgetExceeded: true, image: null })
  })

  it('copies new run images into managed Session resources', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-local-image',
        payload: { text: '', attachments: [] },
        messages: [assistantLocalImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { storedByteFiles }))),
    )

    expect(storedByteFiles).toEqual(['QA evidence.png'])
    expectCapturedLocalImage(upserts)
  })

  it('captures a plain-path evidence image from a run and from backfill', async () => {
    const runUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-plain-path-image',
        payload: { text: '', attachments: [] },
        messages: [assistantPlainPathImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(runUpserts))),
    )
    expect(runUpserts).toContainEqual(
      expect.objectContaining({
        kind: 'image',
        available: true,
        occurrence: expect.objectContaining({
          actor: 'agent',
          activity: 'created',
          locator: PLAIN_IMAGE_PATH,
        }),
      }),
    )

    const backfillUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantPlainPathImageMessage()],
      }).pipe(Effect.provide(sessionResourceTestLayer(backfillUpserts))),
    )
    expect(backfillUpserts).toContainEqual(
      expect.objectContaining({
        kind: 'image',
        occurrence: expect.objectContaining({ locator: PLAIN_IMAGE_PATH }),
      }),
    )
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

  it("lets backfill read images from the Session's own scratch directory", async () => {
    const image = `${sessionScratchDirectoryPath('session-1')}/electron-qa-evidence/final.png`
    const readSourceRoots: Array<readonly string[]> = []
    const recordingReadRoots = Layer.effect(
      SessionResourceStore,
      Effect.map(SessionResourceStore, (store) =>
        SessionResourceStore.of({
          ...store,
          readSource: (input) => {
            readSourceRoots.push(input.allowedRoots)
            return store.readSource(input)
          },
        }),
      ),
    )

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [
          {
            ...assistantLocalImageMessage(),
            parts: [{ type: 'text' as const, text: `![Final](file://${image})` }],
          },
        ],
      }).pipe(Effect.provide(recordingReadRoots), Effect.provide(sessionResourceTestLayer([]))),
    )

    expect(readSourceRoots).toHaveLength(1)
    expect(readSourceRoots[0]).toContain(sessionScratchDirectoryPath('session-1'))
  })
})
