import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import {
  SqliteSessionSemanticProjection,
  sessionDiscoveryDocument,
} from '../sqlite-session-semantic-projection'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const fakeModel: SessionEmbeddingModel = {
  metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

const PRIVATE_SPECIFICATION_MARKER = 'private handoff token'

const specificationPrivacyModel: SessionEmbeddingModel = {
  metadata: { id: 'test/privacy-embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) =>
    texts.map((text) =>
      text.includes(PRIVATE_SPECIFICATION_MARKER)
        ? new Float32Array([1, 0])
        : new Float32Array([0, 1]),
    ),
  embedPassages: async (texts) =>
    texts.map((text) =>
      text.includes(PRIVATE_SPECIFICATION_MARKER)
        ? new Float32Array([1, 0])
        : new Float32Array([0, 1]),
    ),
}

describe('SQLite Session semantic projection', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-projection-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('publishes one atomic snapshot and drains only unchanged queue entries', async () => {
    const runtime = makeRuntime(path.join(root, 'projection.sqlite'))
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionSemanticProjection(sql, fakeModel)
        const before = yield* projection.readiness()
        const prepared = yield* projection.prepareNextBatch(10)
        const after = yield* projection.readiness()
        const embeddings = yield* sql<{
          readonly session_id: string
          readonly model_revision: string
          readonly dimensions: number
          readonly snapshot_revision: number
        }>`
          SELECT session_id, model_revision, dimensions, snapshot_revision
          FROM session_discovery_embeddings ORDER BY session_id
        `
        return { before, prepared, after, embeddings }
      }),
    )

    expect(result.before).toMatchObject({ status: 'unavailable', pendingCount: 3 })
    expect(result.prepared).toMatchObject({ prepared: 3, pending: 0, snapshotRevision: 1 })
    expect(result.after).toMatchObject({
      status: 'ready',
      modelRevision: 'test-1',
      coverage: 1,
      pendingCount: 0,
    })
    expect(result.embeddings).toHaveLength(3)
    expect(result.embeddings[0]).toMatchObject({
      dimensions: 2,
      model_revision: 'test-1',
      snapshot_revision: 1,
    })
  })

  it('builds bounded discovery text from title, objective, and conversation previews', () => {
    expect(
      sessionDiscoveryDocument({
        session_id: 'worker',
        title: 'Migration worker',
        specification_json: '{"objective":"Validate cutover"}',
        initial_content_json: '{"text":"Start with foreign keys"}',
        preview_content_json: '{"text":"Recovery verified"}',
        queued_at: 1,
      }),
    ).toBe('Migration worker\nValidate cutover\nStart with foreign keys\nRecovery verified')
  })

  it('includes only the objective from a Delegation specification', () => {
    const document = sessionDiscoveryDocument({
      session_id: 'worker',
      title: 'Migration worker',
      specification_json: JSON.stringify({
        objective: 'Validate cutover',
        deliverables: ['private deliverable'],
        acceptanceCriteria: ['private acceptance criterion'],
        dependencies: [{ delegationId: 'private-dependency', requiredState: 'accepted' }],
        handoffContext: PRIVATE_SPECIFICATION_MARKER,
        resourceReferences: ['/private/resource'],
      }),
      initial_content_json: null,
      preview_content_json: null,
      queued_at: 1,
    })

    expect(document).toBe('Migration worker\nValidate cutover')
  })

  it('excludes reasoning and tool bodies from semantic discovery text', () => {
    const document = sessionDiscoveryDocument({
      session_id: 'worker',
      title: 'Migration worker',
      specification_json: null,
      initial_content_json: null,
      preview_content_json: JSON.stringify({
        parts: [
          { type: 'text', text: 'Visible answer' },
          { type: 'reasoning', text: 'private reasoning marker' },
          {
            type: 'tool-call',
            toolCall: { name: 'read_file', args: { token: 'private tool marker' } },
          },
          {
            type: 'attachment',
            attachment: { name: 'requirements.txt', extractedText: 'private attachment marker' },
          },
        ],
      }),
      queued_at: 1,
    })

    expect(document).toContain('Visible answer')
    expect(document).toContain('read_file')
    expect(document).toContain('requirements.txt')
    expect(document).not.toContain('private reasoning marker')
    expect(document).not.toContain('private tool marker')
    expect(document).not.toContain('private attachment marker')
  })

  it('excludes private message bodies from ordinary and full-transcript lexical search', async () => {
    const runtime = makeRuntime(path.join(root, 'private-lexical-search.sqlite'))
    runtimes.push(runtime)
    const ordinary = await executeQuery(runtime, {
      operation: 'search',
      query: 'private tool marker',
      limit: 10,
    })
    const fullTranscript = await executeQuery(runtime, {
      operation: 'search',
      query: 'private tool marker',
      searchScope: 'full-transcript',
      limit: 10,
    })

    expect(ordinary.outcome).toMatchObject({ operation: 'search', sessions: [] })
    expect(fullTranscript.outcome).toMatchObject({ operation: 'search', sessions: [] })
  })

  it('does not execute transcript candidate projection for unauthorized Sessions', async () => {
    const runtime = makeRuntime(path.join(root, 'lexical-authority-oracle.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, created_order
          ) VALUES (
            ${'node-private-oracle'}, ${'other'}, ${'message'}, ${'assistant'}, ${1},
            ${'{"text":"hidden lexical oracle"}'}, ${'{}'}, ${0}
          )
        `
        yield* sql.unsafe('DROP INDEX idx_session_nodes_run_created_order')
        yield* sql`
          UPDATE session_nodes SET metadata_json = ${'not-json'}
          WHERE id = ${'node-private-oracle'}
        `
      }),
    )

    const result = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: 'hidden lexical oracle',
        searchScope: 'full-transcript',
        mode: 'lexical',
        limit: 10,
      },
      {
        profileId: 'project-reader',
        profileName: 'project-reader',
        capabilities: ['sessions:discover', 'sessions:read'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(result.outcome).toMatchObject({ operation: 'search', sessions: [] })
  })

  it('does not let a discover-only semantic query match private Delegation fields', async () => {
    const runtime = makeRuntime(
      path.join(root, 'private-delegation-semantic-search.sqlite'),
      specificationPrivacyModel,
    )
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE delegation_specifications
          SET specification_json = ${JSON.stringify({
            objective: 'Validate migration',
            deliverables: ['private deliverable'],
            acceptanceCriteria: ['private acceptance criterion'],
            dependencies: [{ delegationId: 'private-dependency', requiredState: 'accepted' }],
            handoffContext: PRIVATE_SPECIFICATION_MARKER,
            resourceReferences: ['/private/resource'],
          })}
          WHERE delegation_id = ${'delegation-worker'} AND revision = ${1}
        `
        yield* new SqliteSessionSemanticProjection(sql, specificationPrivacyModel).prepareNextBatch(
          10,
        )
      }),
    )

    const result = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: PRIVATE_SPECIFICATION_MARKER,
        mode: 'semantic',
        limit: 1,
      },
      {
        profileId: 'discover-only',
        profileName: 'discover-only',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(result.outcome).toMatchObject({
      operation: 'search',
      sessions: [{ sessionId: 'queen' }],
    })
    expect(JSON.stringify(result)).not.toContain('worker')
  })
})
