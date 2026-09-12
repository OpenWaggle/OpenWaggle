import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { makeSessionResourceCatalogTestLayer } from './sqlite-session-resource-pagination.test-harness'

let tmpRoot = ''

describe('SqliteSessionResourceRepositoryLive targeted catalog lookups', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-targeted-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('uses targeted lookups without hydrating an unbounded catalog', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const byId = yield* repository.findById(SessionId('session-1'), 'resource-1', 'outputs')
        const byOccurrence = yield* repository.findByOccurrence(
          SessionId('session-1'),
          'occurrence-2-11',
          'sources',
        )
        const byLocator = yield* repository.findByLocator(
          SessionId('session-1'),
          'file',
          '/resource-1',
        )
        const candidateIds = Array.from({ length: 400 }, (_, index) =>
          index < 200 ? `occurrence-${String(index)}-0` : `missing-${String(index)}`,
        )
        const occurrences = yield* repository.hasOccurrences(SessionId('session-1'), candidateIds)
        const byNodes = yield* repository.listByNodeIds(
          SessionId('session-1'),
          Array.from({ length: 200 }, (_, index) => `node-${String(index)}-0`),
          'image',
          10,
        )
        const repeatedImage = yield* repository.listByNodeIdsPage(SessionId('session-1'), {
          nodeIds: Array.from({ length: 12 }, (_, index) => `node-0-${String(index)}`),
          kind: 'image',
          limit: 10,
        })
        return { byId, byOccurrence, byLocator, occurrences, byNodes, repeatedImage }
      }).pipe(
        Effect.provide(makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'targeted.sqlite'))),
      ),
    )

    expect(result.byId?.id).toBe('resource-1')
    expect(result.byId?.occurrences).toHaveLength(8)
    expect(result.byId?.occurrences.every(({ activity }) => activity === 'created')).toBe(true)
    expect(result.byOccurrence?.id).toBe('resource-2')
    expect(result.byLocator?.id).toBe('resource-1')
    expect(result.occurrences.size).toBe(200)
    expect(result.byNodes).toHaveLength(10)
    expect(result.byNodes.every(({ sessionId }) => sessionId === 'session-1')).toBe(true)
    expect(result.repeatedImage.resources).toHaveLength(1)
    expect(result.repeatedImage.resources[0]?.occurrences).toHaveLength(12)
  })

  it('loads every selected backfill occurrence across chunks without crossing sessions', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const selectors = Array.from({ length: 450 }, (_, index) => ({
          value: `occurrence-${String(Math.floor(index / 2))}-${String(index % 2)}`,
          prefix: false,
        }))
        const selected = yield* repository.findByOccurrences(SessionId('session-1'), selectors)
        const prefix = yield* repository.findByOccurrences(SessionId('session-1'), [
          { value: 'occurrence-2-1', prefix: true },
        ])
        const foreign = yield* repository.findByOccurrences(SessionId('session-2'), selectors)
        const literalWildcard = yield* repository.findByOccurrences(SessionId('session-1'), [
          { value: 'occurrence-%', prefix: true },
        ])
        return { selected, prefix, foreign, literalWildcard }
      }).pipe(
        Effect.provide(makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'progress.sqlite'))),
      ),
    )

    expect(result.selected).toHaveLength(225)
    expect(result.selected.every(({ occurrences }) => occurrences.length === 2)).toBe(true)
    expect(result.selected.flatMap(({ occurrences }) => occurrences)).toHaveLength(450)
    expect(result.prefix[0]?.occurrences.map(({ id }) => id)).toEqual(['occurrence-2-11'])
    expect(result.foreign).toEqual([])
    expect(result.literalWildcard).toEqual([])
  })
})
