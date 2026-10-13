import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { makeSessionResourceCatalogTestLayer } from './sqlite-session-resource-pagination.test-harness'

let tmpRoot = ''

let resourceCounter = 0

function agentImageUpsert(sessionId: string): UpsertSessionResourceInput {
  resourceCounter += 1
  const id = `agent-image-${resourceCounter}`
  return {
    id,
    sessionId: SessionId(sessionId),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title: 'Evidence screenshot',
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managedPath: '/managed/agent-image.png',
    available: true,
    occurrence: {
      id: `${id}-occurrence`,
      nodeId: 'node-1',
      branchId: null,
      actor: 'agent',
      activity: 'created',
      label: null,
      locator: '/tmp/electron-qa-evidence/shot.png',
      displayName: 'Evidence screenshot',
      createdAt: 2000,
    },
    createdAt: 2000,
    updatedAt: 2000,
  }
}

function agentFileUpsert(sessionId: string): UpsertSessionResourceInput {
  resourceCounter += 1
  const id = `agent-file-${resourceCounter}`
  return {
    id,
    sessionId: SessionId(sessionId),
    canonicalKey: `sha256:${id}`,
    kind: 'file',
    title: 'Generated report',
    mimeType: 'text/plain',
    locator: '/tmp/electron-qa-evidence/report.txt',
    managedPath: null,
    available: true,
    occurrence: {
      id: `${id}-occurrence`,
      nodeId: 'node-1',
      branchId: null,
      actor: 'agent',
      activity: 'created',
      label: null,
      locator: '/tmp/electron-qa-evidence/report.txt',
      createdAt: 2000,
    },
    createdAt: 2000,
    updatedAt: 2000,
  }
}

function toolImageUpsert(sessionId: string): UpsertSessionResourceInput {
  resourceCounter += 1
  const id = `tool-image-${resourceCounter}`
  return {
    id,
    sessionId: SessionId(sessionId),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title: 'Tool screenshot',
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managedPath: '/managed/tool-image.png',
    available: true,
    occurrence: {
      id: `${id}-occurrence`,
      nodeId: 'node-1',
      branchId: null,
      actor: 'tool',
      activity: 'created',
      label: null,
      locator: null,
      createdAt: 2000,
    },
    createdAt: 2000,
    updatedAt: 2000,
  }
}

describe('agent-embedded images are discoverable as sources', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-image-sources-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('marks an agent-captured image as both source and output and hydrates it in the sources view', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const image = yield* repository.upsert(agentImageUpsert('session-1'))
        const sources = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 500,
        })
        const outputs = yield* repository.listPage(SessionId('session-1'), {
          view: 'outputs',
          limit: 500,
        })
        const fromSourcesView = yield* repository.findById(
          SessionId('session-1'),
          image.id,
          'sources',
        )
        return { image, sources, outputs, fromSourcesView }
      }).pipe(
        Effect.provide(
          makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'agent-image.sqlite')),
        ),
      ),
    )

    expect(result.image.isSource).toBe(true)
    expect(result.image.isOutput).toBe(true)
    expect(result.image.occurrences).toEqual([
      expect.objectContaining({ actor: 'agent', activity: 'created' }),
    ])
    expect(result.sources.resources.map(({ id }) => id)).toContain(result.image.id)
    expect(result.outputs.resources.map(({ id }) => id)).toContain(result.image.id)
    expect(result.fromSourcesView).toEqual(
      expect.objectContaining({
        id: result.image.id,
        occurrences: [expect.objectContaining({ actor: 'agent', activity: 'created' })],
      }),
    )
  })

  it('leaves agent-created files and tool-captured images out of Sources', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const file = yield* repository.upsert(agentFileUpsert('session-1'))
        const toolImage = yield* repository.upsert(toolImageUpsert('session-1'))
        const sources = yield* repository.listPage(SessionId('session-1'), {
          view: 'sources',
          limit: 500,
        })
        const fileFromSources = yield* repository.findById(
          SessionId('session-1'),
          file.id,
          'sources',
        )
        const toolImageFromSources = yield* repository.findById(
          SessionId('session-1'),
          toolImage.id,
          'sources',
        )
        return { file, toolImage, sources, fileFromSources, toolImageFromSources }
      }).pipe(
        Effect.provide(
          makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'agent-file-sources.sqlite')),
        ),
      ),
    )

    expect(result.file.isSource).toBe(false)
    expect(result.file.isOutput).toBe(true)
    expect(result.toolImage.isSource).toBe(false)
    expect(result.toolImage.isOutput).toBe(true)
    expect(result.sources.resources.map(({ id }) => id)).not.toContain(result.file.id)
    expect(result.sources.resources.map(({ id }) => id)).not.toContain(result.toolImage.id)
    expect(result.fileFromSources).toBeNull()
    expect(result.toolImageFromSources).toBeNull()
  })
})
