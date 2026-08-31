import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SessionEmbeddingModel } from '../adapters/multilingual-e5-session-embedding-model'
import { encodeFloat32Vector } from '../adapters/session-flat-vector-index'
import { sessionDiscoveryDocument } from '../adapters/sqlite-session-semantic-projection'
import { cutoverRecord } from './session-host-cutover-database'

const CUTOVER_EMBEDDING_BATCH_SIZE = 32

interface CutoverProjectionRow {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_content_json: string | null
  readonly preview_content_json: string | null
  readonly queued_at: number
}

function nullableString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Semantic cutover row has invalid ${key}.`)
  return value
}

function decodeProjectionRow(value: unknown): CutoverProjectionRow {
  const row = cutoverRecord(value)
  if (!row || typeof row.session_id !== 'string' || typeof row.title !== 'string') {
    throw new Error('Semantic cutover projection row is invalid.')
  }
  return {
    session_id: row.session_id,
    title: row.title,
    specification_json: nullableString(row, 'specification_json'),
    initial_content_json: nullableString(row, 'initial_content_json'),
    preview_content_json: nullableString(row, 'preview_content_json'),
    queued_at: typeof row.queued_at === 'number' ? row.queued_at : 0,
  }
}

function loadBatch(database: DatabaseSync) {
  const values: unknown = database
    .prepare(`
      SELECT queue.session_id, sessions.title, queue.queued_at,
        specifications.specification_json,
        (SELECT initial.content_json FROM session_nodes AS initial
          WHERE initial.session_id = sessions.id AND initial.role = 'user'
          ORDER BY initial.created_order, initial.id LIMIT 1) AS initial_content_json,
        (SELECT preview.content_json FROM session_nodes AS preview
          WHERE preview.session_id = sessions.id AND preview.role IN ('user', 'assistant')
          ORDER BY preview.created_order DESC, preview.id DESC LIMIT 1) AS preview_content_json
      FROM session_discovery_embedding_queue AS queue
      JOIN sessions ON sessions.id = queue.session_id
      LEFT JOIN delegation_contracts AS contracts ON contracts.child_session_id = sessions.id
      LEFT JOIN delegation_specifications AS specifications
        ON specifications.delegation_id = contracts.id
        AND specifications.revision = contracts.current_specification_revision
      ORDER BY queue.queued_at, queue.session_id
      LIMIT ?
    `)
    .all(CUTOVER_EMBEDDING_BATCH_SIZE)
  if (!Array.isArray(values)) throw new Error('Semantic cutover rows could not be loaded.')
  return values.map(decodeProjectionRow)
}

function sourceHash(document: string) {
  return createHash('sha256').update(document).digest('hex')
}

function publishBatch(
  database: DatabaseSync,
  model: SessionEmbeddingModel,
  rows: readonly CutoverProjectionRow[],
  vectors: readonly Float32Array[],
  revision: number,
  now: number,
) {
  const insert = database.prepare(`
    INSERT INTO session_discovery_embeddings (
      session_id, model_id, model_revision, dimensions, source_hash,
      vector, snapshot_revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const remove = database.prepare(`
    DELETE FROM session_discovery_embedding_queue WHERE session_id = ? AND queued_at = ?
  `)
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const [index, row] of rows.entries()) {
      const vector = vectors[index]
      if (!vector || vector.length !== model.metadata.dimensions) {
        throw new Error('Semantic cutover vector dimensions mismatch.')
      }
      const document = sessionDiscoveryDocument(row)
      insert.run(
        row.session_id,
        model.metadata.id,
        model.metadata.revision,
        model.metadata.dimensions,
        sourceHash(document),
        encodeFloat32Vector(vector),
        revision,
        now,
      )
      remove.run(row.session_id, row.queued_at)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function publishReadyState(
  database: DatabaseSync,
  model: SessionEmbeddingModel,
  snapshotRevision: number,
  preparedCount: number,
  now: number,
) {
  database
    .prepare(`
      INSERT INTO session_semantic_discovery_state (
        singleton, status, model_id, model_revision, dimensions,
        snapshot_revision, prepared_count, pending_count,
        preparation_operation_id, failure_message, updated_at
      ) VALUES (1, 'ready', ?, ?, ?, ?, ?, 0, ?, NULL, ?)
    `)
    .run(
      model.metadata.id,
      model.metadata.revision,
      model.metadata.dimensions,
      snapshotRevision,
      preparedCount,
      randomUUID(),
      now,
    )
}

export async function populateSessionHostSemanticIndex(
  databasePath: string,
  model: SessionEmbeddingModel,
  now: number,
) {
  const database = new (await import('node:sqlite')).DatabaseSync(databasePath)
  let revision = 0
  let preparedCount = 0
  try {
    while (true) {
      const rows = loadBatch(database)
      if (rows.length === 0) break
      const vectors = await model.embedPassages(rows.map(sessionDiscoveryDocument))
      revision += 1
      publishBatch(database, model, rows, vectors, revision, now)
      preparedCount += rows.length
    }
    publishReadyState(database, model, revision, preparedCount, now)
  } finally {
    database.close()
  }
}
