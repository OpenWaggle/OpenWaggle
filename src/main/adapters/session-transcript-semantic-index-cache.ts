import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as STORAGE_POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { decodeFloat32Vector, SessionFlatVectorIndex } from './session-flat-vector-index'

const MAX_CACHED_SCOPE_COUNT = 4
const MAX_CACHED_RECORD_COUNT = STORAGE_POLICY.totalNodeLimit

interface StoredTranscriptVectorRow {
  readonly node_id: string
  readonly session_id: string
  readonly dimensions: number
  readonly vector: Uint8Array
  readonly snapshot_revision: number
}

interface ScopeRevisionRow {
  readonly record_count: number
  readonly snapshot_revision: number
}

interface CachedScopeIndex {
  readonly index: SessionFlatVectorIndex
  readonly nodeIds: Set<string>
  recordCount: number
  revision: number
  lastAccess: number
}

function scopeCacheKey(model: SessionEmbeddingModel, sessionIds: readonly string[]) {
  const hash = createHash('sha256')
  hash.update(model.metadata.id)
  hash.update('\0')
  hash.update(model.metadata.revision)
  for (const sessionId of sessionIds.toSorted()) {
    hash.update('\0')
    hash.update(sessionId)
  }
  return hash.digest('hex')
}

function vectorRecord(row: StoredTranscriptVectorRow) {
  return {
    sessionId: row.node_id,
    groupId: row.session_id,
    vector: decodeFloat32Vector(row.vector, row.dimensions),
  }
}

export class SessionTranscriptSemanticIndexCache {
  readonly #entries = new Map<string, CachedScopeIndex>()
  readonly #refreshLock = Effect.runSync(Effect.makeSemaphore(1))
  #totalRecords = 0
  #accessSequence = 0
  #fullRebuilds = 0

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
  ) {}

  load(sessionIds: readonly string[]): Effect.Effect<SessionFlatVectorIndex, SqlError> {
    if (sessionIds.length === 0) return Effect.succeed(new SessionFlatVectorIndex())
    return this.#refreshLock.withPermits(1)(
      Effect.gen(this, function* () {
        const key = scopeCacheKey(this.model, sessionIds)
        const revision = yield* this.#readScopeRevision(sessionIds)
        const existing = this.#entries.get(key)
        if (
          existing &&
          existing.revision === revision.snapshot_revision &&
          existing.recordCount === revision.record_count
        ) {
          existing.lastAccess = this.#nextAccess()
          return existing.index
        }
        const previousRecordCount = existing?.recordCount ?? 0
        const refreshed = existing
          ? yield* this.#refreshExisting(existing, sessionIds, revision)
          : yield* this.#rebuild(sessionIds, revision)
        this.#store(key, refreshed, previousRecordCount)
        return refreshed.index
      }),
    )
  }

  diagnostics() {
    return {
      cachedScopes: this.#entries.size,
      cachedRecords: this.#totalRecords,
      fullRebuilds: this.#fullRebuilds,
    }
  }

  #readScopeRevision(sessionIds: readonly string[]) {
    return this.sql<ScopeRevisionRow>`
      SELECT COUNT(*) AS record_count,
        COALESCE(MAX(snapshot_revision), 0) AS snapshot_revision
      FROM session_transcript_embeddings
      WHERE model_id = ${this.model.metadata.id}
        AND model_revision = ${this.model.metadata.revision}
        AND session_id IN ${this.sql.in(sessionIds)}
    `.pipe(Effect.map((rows) => rows[0] ?? { record_count: 0, snapshot_revision: 0 }))
  }

  #loadAll(sessionIds: readonly string[]) {
    return this.sql<StoredTranscriptVectorRow>`
      SELECT node_id, session_id, dimensions, vector, snapshot_revision
      FROM session_transcript_embeddings
      WHERE model_id = ${this.model.metadata.id}
        AND model_revision = ${this.model.metadata.revision}
        AND session_id IN ${this.sql.in(sessionIds)}
    `
  }

  #rebuild(sessionIds: readonly string[], revision: ScopeRevisionRow) {
    return Effect.gen(this, function* () {
      const rows = yield* this.#loadAll(sessionIds)
      const index = new SessionFlatVectorIndex()
      index.replace(rows.map(vectorRecord))
      this.#fullRebuilds += 1
      return {
        index,
        nodeIds: new Set(rows.map((row) => row.node_id)),
        recordCount: rows.length,
        revision: revision.snapshot_revision,
        lastAccess: this.#nextAccess(),
      } satisfies CachedScopeIndex
    })
  }

  #refreshExisting(
    existing: CachedScopeIndex,
    sessionIds: readonly string[],
    revision: ScopeRevisionRow,
  ) {
    if (revision.snapshot_revision < existing.revision) return this.#rebuild(sessionIds, revision)
    return Effect.gen(this, function* () {
      const currentIds = yield* this.sql<{ readonly node_id: string }>`
        SELECT node_id FROM session_transcript_embeddings
        WHERE model_id = ${this.model.metadata.id}
          AND model_revision = ${this.model.metadata.revision}
          AND session_id IN ${this.sql.in(sessionIds)}
      `
      const retainedIds = new Set(currentIds.map((row) => row.node_id))
      for (const nodeId of existing.nodeIds) {
        if (!retainedIds.has(nodeId)) existing.index.remove(nodeId)
      }
      const changed = yield* this.sql<StoredTranscriptVectorRow>`
        SELECT node_id, session_id, dimensions, vector, snapshot_revision
        FROM session_transcript_embeddings
        WHERE model_id = ${this.model.metadata.id}
          AND model_revision = ${this.model.metadata.revision}
          AND session_id IN ${this.sql.in(sessionIds)}
          AND snapshot_revision > ${existing.revision}
      `
      for (const row of changed) existing.index.upsert(vectorRecord(row))
      existing.nodeIds.clear()
      for (const nodeId of retainedIds) existing.nodeIds.add(nodeId)
      existing.recordCount = retainedIds.size
      existing.revision = revision.snapshot_revision
      existing.lastAccess = this.#nextAccess()
      if (existing.index.size !== revision.record_count)
        return yield* this.#rebuild(sessionIds, revision)
      return existing
    })
  }

  #store(key: string, entry: CachedScopeIndex, previousRecordCount: number) {
    const previous = this.#entries.get(key)
    if (previous) this.#totalRecords -= previousRecordCount
    this.#entries.set(key, entry)
    this.#totalRecords += entry.recordCount
    while (
      this.#entries.size > MAX_CACHED_SCOPE_COUNT ||
      this.#totalRecords > MAX_CACHED_RECORD_COUNT
    ) {
      const eviction = [...this.#entries.entries()]
        .filter(([candidateKey]) => candidateKey !== key)
        .toSorted((left, right) => left[1].lastAccess - right[1].lastAccess)[0]
      if (!eviction) break
      this.#entries.delete(eviction[0])
      this.#totalRecords -= eviction[1].recordCount
    }
  }

  #nextAccess() {
    this.#accessSequence += 1
    return this.#accessSequence
  }
}
