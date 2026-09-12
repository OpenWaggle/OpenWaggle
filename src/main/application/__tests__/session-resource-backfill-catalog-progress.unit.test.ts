import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MessageId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeSessionResourceCatalogTestLayer } from '../../adapters/__tests__/sqlite-session-resource-pagination.test-harness'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureUnavailableGeneratedImage } from '../session-resource-capture-image'
import {
  assistantToolResultMessage,
  PNG_BASE64,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

let tmpRoot = ''
const sessionId = SessionId('session-1')

describe('durable resource backfill progress', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-backfill-progress-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('finishes repeated image slots in one node across bounded passes', async () => {
    const imageCount = 40
    const message = assistantToolResultMessage(false, {
      name: 'imagegen',
      result: {
        content: Array.from({ length: imageCount }, () => ({
          type: 'image',
          data: PNG_BASE64,
          mimeType: 'image/png',
        })),
      },
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* captureProjectedSessionResources({ sessionId, messages: [message] })
        const second = yield* captureProjectedSessionResources({ sessionId, messages: [message] })
        const repository = yield* SessionResourceRepository
        const images = (yield* repository.list(sessionId)).filter(({ kind }) => kind === 'image')
        return { first, second, images }
      }).pipe(
        Effect.provide(makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'progress.sqlite'))),
        Effect.provide(sessionResourceTestLayer([])),
      ),
    )

    expect(result.first.fullyProjected).toBe(false)
    expect(result.second.fullyProjected).toBe(true)
    const generated = result.images.find(({ managed }) => managed)
    expect(generated?.occurrences).toHaveLength(imageCount)
  })

  it('resumes past 512 existing image resources without re-spending the capture budget', async () => {
    const messages = Array.from({ length: 6 }, (_, messageIndex) => ({
      ...assistantToolResultMessage(false, {
        name: 'imagegen',
        result: {
          content: Array.from({ length: 100 }, () => ({
            type: 'image',
            data: 'invalid-image',
            mimeType: 'image/png',
          })),
        },
      }),
      id: MessageId(`many-images-${String(messageIndex)}`),
    }))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        for (let slot = 0; slot < 512; slot += 1) {
          yield* captureUnavailableGeneratedImage({
            sessionId,
            nodeId: `many-images-${String(Math.floor(slot / 100))}`,
            index: slot % 100,
            createdAt: 2000,
            image: { data: 'invalid-image', mimeType: 'image/png', title: 'Image' },
          })
        }
        const first = yield* captureProjectedSessionResources({ sessionId, messages })
        const second = yield* captureProjectedSessionResources({ sessionId, messages })
        const third = yield* captureProjectedSessionResources({ sessionId, messages })
        const repository = yield* SessionResourceRepository
        const images = (yield* repository.list(sessionId)).filter(({ canonicalKey }) =>
          canonicalKey.startsWith('unavailable-image:'),
        )
        return { first, second, third, count: images.length }
      }).pipe(
        Effect.provide(makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'many.sqlite'))),
        Effect.provide(sessionResourceTestLayer([])),
      ),
    )

    expect(result.first.fullyProjected).toBe(false)
    expect(result.second.fullyProjected).toBe(false)
    expect(result.third.fullyProjected).toBe(true)
    expect(result.count).toBe(600)
  })
})
