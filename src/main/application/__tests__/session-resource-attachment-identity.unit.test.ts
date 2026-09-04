import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureAttachment } from '../session-resource-capture'
import { attachmentOccurrenceId } from '../session-resource-capture-attachment'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('session attachment identity', () => {
  it('keeps failed attachments separate when different attachment IDs reuse a path', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const layer = sessionResourceTestLayer(upserts, { storeFileFails: true })
    const baseInput = {
      sessionId: SessionId('session-1'),
      runId: 'shared-path-run',
      index: 0,
      createdAt: 1000,
      branchId: null,
    } as const

    for (const [attachmentId, nodeId] of [
      ['first-attachment', 'first-node'],
      ['second-attachment', 'second-node'],
    ] as const) {
      await Effect.runPromise(
        captureAttachment({
          ...baseInput,
          nodeId,
          attachment: {
            id: attachmentId,
            kind: 'image',
            name: `${attachmentId}.png`,
            path: '/input/shared.png',
            mimeType: 'image/png',
            sizeBytes: 42,
            extractedText: '',
          },
        }).pipe(Effect.provide(layer)),
      )
    }

    expect(upserts).toHaveLength(2)
    expect(upserts[0]?.canonicalKey).not.toBe(upserts[1]?.canonicalKey)
    expect(upserts.map(({ canonicalKey }) => canonicalKey)).toEqual([
      expect.stringContaining('first-attachment'),
      expect.stringContaining('second-attachment'),
    ])
  })

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

  it('repairs a legacy path-keyed placeholder only for its original occurrence', async () => {
    const input = {
      sessionId: SessionId('session-1'),
      runId: 'legacy-retry',
      attachment: {
        id: 'legacy-attachment',
        kind: 'image' as const,
        name: 'legacy.png',
        path: '/input/legacy.png',
        mimeType: 'image/png',
        sizeBytes: 42,
        extractedText: '',
      },
      index: 0,
      nodeId: 'legacy-node',
      createdAt: 2000,
    }
    const legacy: SessionResource = {
      id: 'legacy-placeholder',
      sessionId: input.sessionId,
      canonicalKey: 'file:/input/legacy.png',
      kind: 'file',
      title: 'legacy.png',
      mimeType: 'image/png',
      locator: '/input/legacy.png',
      managed: false,
      available: false,
      isSource: true,
      isOutput: false,
      occurrences: [
        {
          id: attachmentOccurrenceId(input),
          nodeId: input.nodeId,
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
      captureAttachment({ ...input, repairResource: legacy }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            existingResources: [legacy],
            listedResources: [legacy],
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expect(rekeyedCanonicalKeys).toEqual(['sha256:attachment-digest'])
    expect(upserts).toContainEqual(
      expect.objectContaining({ id: 'legacy-placeholder', available: true }),
    )
  })

  it('refuses to repair an unsplit legacy placeholder with multiple occurrences', async () => {
    const input = {
      sessionId: SessionId('session-1'),
      runId: 'ambiguous-legacy-retry',
      attachment: {
        id: 'first-attachment',
        kind: 'image' as const,
        name: 'first.png',
        path: '/input/shared.png',
        mimeType: 'image/png',
        sizeBytes: 42,
        extractedText: '',
      },
      index: 0,
      nodeId: 'first-node',
      createdAt: 2000,
    }
    const legacy: SessionResource = {
      id: 'ambiguous-placeholder',
      sessionId: input.sessionId,
      canonicalKey: 'file:/input/shared.png',
      kind: 'file',
      title: 'shared.png',
      mimeType: 'image/png',
      locator: '/input/shared.png',
      managed: false,
      available: false,
      isSource: true,
      isOutput: false,
      occurrences: [
        {
          id: attachmentOccurrenceId(input),
          nodeId: input.nodeId,
          branchId: null,
          actor: 'user',
          activity: 'provided',
          label: null,
          createdAt: 1000,
        },
        {
          id: 'session-1:second-node:provided:attachment:second-attachment:0',
          nodeId: 'second-node',
          branchId: null,
          actor: 'user',
          activity: 'provided',
          label: null,
          createdAt: 1001,
        },
      ],
      createdAt: 1000,
      updatedAt: 1001,
    }
    const upserts: UpsertSessionResourceInput[] = []
    const rekeyedCanonicalKeys: string[] = []

    await Effect.runPromise(
      captureAttachment({ ...input, repairResource: legacy }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            existingResources: [legacy],
            listedResources: [legacy],
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expect(upserts).toEqual([])
    expect(rekeyedCanonicalKeys).toEqual([])
  })
})
