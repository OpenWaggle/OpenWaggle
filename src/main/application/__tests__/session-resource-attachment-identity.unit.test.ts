import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureAttachment } from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('session attachment identity', () => {
  it('does not replace an unavailable attachment when a different attachment reuses its path', async () => {
    const unavailable: SessionResource = {
      id: 'first-missing-resource',
      sessionId: SessionId('session-1'),
      canonicalKey: 'file:/input/shared.png',
      kind: 'file',
      title: 'first.png',
      mimeType: 'image/png',
      locator: '/input/shared.png',
      managed: false,
      available: false,
      isSource: true,
      isOutput: false,
      occurrences: [
        {
          id: 'session-1:first-node:provided:attachment:first-attachment:0',
          nodeId: 'first-node',
          branchId: null,
          actor: 'user',
          activity: 'provided',
          label: null,
          createdAt: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const upserts: UpsertSessionResourceInput[] = []
    const rekeyedCanonicalKeys: string[] = []

    await Effect.runPromise(
      captureAttachment({
        sessionId: SessionId('session-1'),
        runId: 'second-run',
        attachment: {
          id: 'second-attachment',
          kind: 'image',
          name: 'second.png',
          path: '/input/shared.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          extractedText: '',
        },
        index: 0,
        nodeId: 'second-node',
        createdAt: 2000,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            existingResources: [unavailable],
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expect(upserts).toHaveLength(1)
    expect(upserts[0]).not.toMatchObject({ id: 'first-missing-resource' })
    expect(upserts[0]).toMatchObject({ canonicalKey: 'sha256:attachment-digest' })
    expect(rekeyedCanonicalKeys).toEqual([])
  })
})
