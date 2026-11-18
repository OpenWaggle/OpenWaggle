import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const currentModel: SessionEmbeddingModel = {
  metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}
const previousModel: SessionEmbeddingModel = {
  ...currentModel,
  metadata: { ...currentModel.metadata, revision: 'test-0' },
}

it('requeues incompatible embeddings and counts only the current model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-model-revision-'))
  const runtime = makeSessionQueryRuntime(path.join(root, 'model-revision.sqlite'))
  try {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, previousModel).prepareNextBatch(10)
        const projection = new SqliteSessionSemanticProjection(sql, currentModel)
        const reconciled = yield* projection.readiness()
        const batch = yield* projection.prepareNextBatch(1)
        const preparing = yield* projection.readiness()
        const stored = yield* sql<{ readonly current: number; readonly incompatible: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_discovery_embeddings
              WHERE model_id = ${currentModel.metadata.id}
                AND model_revision = ${currentModel.metadata.revision}
                AND dimensions = ${currentModel.metadata.dimensions}) AS current,
            (SELECT COUNT(*) FROM session_discovery_embeddings
              WHERE model_id <> ${currentModel.metadata.id}
                OR model_revision <> ${currentModel.metadata.revision}
                OR dimensions <> ${currentModel.metadata.dimensions}) AS incompatible
        `
        return { reconciled, batch, preparing, stored: stored[0] }
      }),
    )
    expect(result.reconciled).toMatchObject({
      status: 'preparing',
      modelRevision: 'test-1',
      coverage: 0,
      pendingCount: 3,
    })
    expect(result.batch).toMatchObject({ prepared: 1, pending: 2 })
    expect(result.preparing).toMatchObject({
      status: 'preparing',
      modelRevision: 'test-1',
      coverage: 1 / 3,
      pendingCount: 2,
    })
    expect(result.stored).toEqual({ current: 1, incompatible: 0 })
  } finally {
    await runtime.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
