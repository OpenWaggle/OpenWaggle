import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureLink } from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('session resource link identity', () => {
  it('does not let a generic link adopt a legacy image row', async () => {
    const legacyImage: SessionResource = {
      id: 'legacy-extension-image',
      sessionId: SessionId('session-1'),
      canonicalKey: 'url:https://images.example.com/architecture.png',
      kind: 'image',
      title: 'Extension image',
      mimeType: null,
      locator: 'https://images.example.com/architecture.png',
      managed: false,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureLink({
        sessionId: SessionId('session-1'),
        runId: 'run-generic-reference',
        link: {
          url: 'https://images.example.com/architecture.png',
          title: 'Documentation',
          image: false,
        },
        index: 0,
        nodeId: 'assistant-message',
        actor: 'agent',
        activity: 'read',
        createdAt: 2000,
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { existingResources: [legacyImage] })),
      ),
    )

    expect(upserts).toEqual([])
  })

  it('keeps a Markdown image separate from an existing change-request URL', async () => {
    const changeRequest: SessionResource = {
      id: 'change-request-resource',
      sessionId: SessionId('session-1'),
      canonicalKey: 'url:https://github.com/openwaggle/openwaggle/pull/42',
      kind: 'change-request',
      title: 'Session Summary resource hub',
      mimeType: null,
      locator: 'https://github.com/openwaggle/openwaggle/pull/42',
      managed: false,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureLink({
        sessionId: SessionId('session-1'),
        runId: 'run-image-reference',
        link: {
          url: 'https://github.com/openwaggle/openwaggle/pull/42',
          title: 'Rendered preview',
          image: true,
        },
        index: 0,
        nodeId: 'assistant-message',
        actor: 'agent',
        activity: 'read',
        createdAt: 2000,
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { existingResources: [changeRequest] })),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'image-url:https://github.com/openwaggle/openwaggle/pull/42',
        kind: 'image',
        title: 'Rendered preview',
      }),
    )
    expect(upserts).not.toContainEqual(expect.objectContaining({ id: 'change-request-resource' }))
  })
})
