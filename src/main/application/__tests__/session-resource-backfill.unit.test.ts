import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('captureProjectedSessionResources', () => {
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
